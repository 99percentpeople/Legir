import { pdfWorkerService } from "./pdfService/pdfWorkerService";

export type RecentFileEntry = {
  path: string;
  filename: string;
  lastOpenedAt: number;
  previewDataUrl?: string;
  previewUpdatedAt?: number;
  lastViewState?: {
    scale: number;
    scrollLeft: number;
    scrollTop: number;
    updatedAt: number;
    pageIndex?: number;
  };
};

type PreviewTaskKey = string;

/**
 * Single authoritative service for:
 * - Tauri recent files persistence (localStorage)
 * - Preview thumbnail generation (serialized queue + de-dupe + cancellation)
 * - Web resumable session flags
 */
export class RecentFilesService {
  private readonly STORAGE_KEY = "ff-recent-files";
  private readonly WEB_SAVED_SESSION_KEY = "ff-web-has-saved-session";
  private readonly MAX_ENTRIES = 50;

  private previewQueue: Promise<void> = Promise.resolve();
  private previewControllersByKey = new Map<PreviewTaskKey, AbortController>();
  private previewInFlightByKey = new Map<
    PreviewTaskKey,
    Promise<string | null>
  >();
  private previewKeyByPath = new Map<string, PreviewTaskKey>();

  private safeParse(raw: string | null): RecentFileEntry[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((x) => x && typeof x === "object")
        .map((x) => ({
          path: String(x.path ?? ""),
          filename: String(x.filename ?? ""),
          lastOpenedAt: Number(x.lastOpenedAt ?? 0),
          previewDataUrl:
            typeof x.previewDataUrl === "string"
              ? String(x.previewDataUrl)
              : typeof x.thumbnailDataUrl === "string"
                ? String(x.thumbnailDataUrl)
                : undefined,
          previewUpdatedAt:
            typeof x.previewUpdatedAt === "number"
              ? Number(x.previewUpdatedAt)
              : typeof x.thumbnailUpdatedAt === "number"
                ? Number(x.thumbnailUpdatedAt)
                : undefined,
          lastViewState:
            x.lastViewState && typeof x.lastViewState === "object"
              ? {
                  scale: Number(x.lastViewState.scale ?? 0),
                  scrollLeft: Number(x.lastViewState.scrollLeft ?? 0),
                  scrollTop: Number(x.lastViewState.scrollTop ?? 0),
                  updatedAt: Number(x.lastViewState.updatedAt ?? 0),
                  pageIndex:
                    typeof x.lastViewState.pageIndex === "number"
                      ? Math.max(
                          0,
                          Math.floor(Number(x.lastViewState.pageIndex)),
                        )
                      : undefined,
                }
              : undefined,
        }))
        .filter((x) => x.path && x.filename && Number.isFinite(x.lastOpenedAt))
        .map((x) => {
          if (!x.lastViewState) return x;
          if (
            !Number.isFinite(x.lastViewState.scale) ||
            !Number.isFinite(x.lastViewState.scrollLeft) ||
            !Number.isFinite(x.lastViewState.scrollTop) ||
            !Number.isFinite(x.lastViewState.updatedAt)
          ) {
            return { ...x, lastViewState: undefined };
          }
          if (
            x.lastViewState.pageIndex !== undefined &&
            (!Number.isFinite(x.lastViewState.pageIndex) ||
              x.lastViewState.pageIndex < 0)
          ) {
            return {
              ...x,
              lastViewState: {
                ...x.lastViewState,
                pageIndex: undefined,
              },
            };
          }
          return x;
        });
    } catch {
      return [];
    }
  }

  private setRecentFiles(entries: RecentFileEntry[]) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(this.STORAGE_KEY, JSON.stringify(entries));
  }

  private buildPreviewKey(options: {
    path: string;
    targetWidth?: number;
    renderAnnotations?: boolean;
  }): PreviewTaskKey {
    const renderAnnotations = options.renderAnnotations !== false;
    return `${options.path}::${options.targetWidth ?? 240}::${
      renderAnnotations ? "1" : "0"
    }`;
  }

  private cancelPreviewTaskByKey(key: PreviewTaskKey) {
    const ctrl = this.previewControllersByKey.get(key);
    if (!ctrl) return;
    try {
      ctrl.abort();
    } catch {}
    this.previewControllersByKey.delete(key);
    this.previewInFlightByKey.delete(key);
  }

  private setRecentFilePreview(options: {
    path: string;
    previewDataUrl: string;
    previewUpdatedAt?: number;
  }) {
    const current = this.getAll();
    const now = options.previewUpdatedAt ?? Date.now();

    const next = current.map((e) =>
      e.path === options.path
        ? {
            ...e,
            previewDataUrl: options.previewDataUrl,
            previewUpdatedAt: now,
          }
        : e,
    );
    this.setRecentFiles(next);
    return next;
  }

  private scheduleRecentFilePreviewUpdate(options: {
    path: string;
    createPreview: (signal: AbortSignal) => Promise<string | null>;
    previewUpdatedAt?: number;
    targetWidth?: number;
    renderAnnotations?: boolean;
  }) {
    const key = this.buildPreviewKey({
      path: options.path,
      targetWidth: options.targetWidth,
      renderAnnotations: options.renderAnnotations,
    });

    const prevKeyForPath = this.previewKeyByPath.get(options.path);
    if (prevKeyForPath && prevKeyForPath !== key) {
      this.cancelPreviewTaskByKey(prevKeyForPath);
    }

    this.previewKeyByPath.set(options.path, key);

    if (this.previewInFlightByKey.has(key)) return;

    const ctrl = new AbortController();
    this.previewControllersByKey.set(key, ctrl);

    const run = this.previewQueue
      .catch(() => {})
      .then(async () => {
        if (ctrl.signal.aborted) return null;
        const thumb = await options
          .createPreview(ctrl.signal)
          .catch(() => null);
        if (!thumb) return null;
        this.setRecentFilePreview({
          path: options.path,
          previewDataUrl: thumb,
          previewUpdatedAt: options.previewUpdatedAt,
        });
        return thumb;
      })
      .finally(() => {
        const cur = this.previewControllersByKey.get(key);
        if (cur === ctrl) {
          this.previewControllersByKey.delete(key);
          this.previewInFlightByKey.delete(key);
        }
        if (this.previewKeyByPath.get(options.path) === key) {
          this.previewKeyByPath.delete(options.path);
        }
      });

    this.previewInFlightByKey.set(key, run);
    this.previewQueue = run.then(() => undefined);
  }

  /** Cancel all in-flight or queued preview render tasks. */
  cancelPreviewTasks() {
    for (const key of Array.from(this.previewControllersByKey.keys())) {
      this.cancelPreviewTaskByKey(key);
    }
    this.previewKeyByPath.clear();
  }

  /** Await the internal preview queue. */
  waitForPreviewQueue() {
    return this.previewQueue;
  }

  private async bytesToDataUrl(bytes: Uint8Array, mimeType: string) {
    const safeBytes = new Uint8Array(bytes);
    const blob = new Blob([safeBytes as unknown as BlobPart], {
      type: mimeType,
    });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Read and return recent files (sorted by `lastOpenedAt` desc).
   * Desktop-only: on Web it always returns an empty list.
   */
  getAll(): RecentFileEntry[] {
    if (typeof window === "undefined") return [];
    const items = this.safeParse(window.localStorage.getItem(this.STORAGE_KEY));
    return items.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }

  /** Upsert a recent file entry without updating preview. */
  upsert(entry: { path: string; filename: string; lastOpenedAt?: number }) {
    const now = entry.lastOpenedAt ?? Date.now();
    const current = this.getAll();
    const filtered = current.filter((e) => e.path !== entry.path);
    const previous = current.find((e) => e.path === entry.path);
    const next: RecentFileEntry[] = [
      {
        path: entry.path,
        filename: entry.filename,
        lastOpenedAt: now,
        previewDataUrl: previous?.previewDataUrl,
        previewUpdatedAt: previous?.previewUpdatedAt,
        lastViewState: previous?.lastViewState,
      },
      ...filtered,
    ].slice(0, this.MAX_ENTRIES);
    this.setRecentFiles(next);
    return next;
  }

  /** Remove a single recent file entry by path. */
  remove(path: string) {
    const current = this.getAll();
    const next = current.filter((e) => e.path !== path);
    this.setRecentFiles(next);
    return next;
  }

  /** Clear all recent files. */
  clear() {
    this.setRecentFiles([]);
    return [] as RecentFileEntry[];
  }

  /** Get the persisted last view state for a recent file path. */
  getViewState(path: string) {
    const current = this.getAll();
    return current.find((e) => e.path === path)?.lastViewState ?? null;
  }

  private setRecentFileViewState(options: {
    path: string;
    scale: number;
    scrollLeft: number;
    scrollTop: number;
    updatedAt?: number;
    pageIndex?: number;
  }) {
    const current = this.getAll();
    const now = options.updatedAt ?? Date.now();
    const next = current.map((e) =>
      e.path === options.path
        ? {
            ...e,
            lastViewState: {
              scale: options.scale,
              scrollLeft: options.scrollLeft,
              scrollTop: options.scrollTop,
              updatedAt: now,
              pageIndex:
                typeof options.pageIndex === "number"
                  ? options.pageIndex
                  : undefined,
            },
          }
        : e,
    );
    this.setRecentFiles(next);
    return next;
  }

  /** Persist Tauri view state from explicit scroll coordinates. */
  saveTauriViewState(options: {
    path: string;
    scale: number;
    scrollLeft: number;
    scrollTop: number;
    pageIndex?: number;
    updatedAt?: number;
  }) {
    this.setRecentFileViewState({
      path: options.path,
      scale: options.scale,
      scrollLeft: options.scrollLeft,
      scrollTop: options.scrollTop,
      pageIndex: options.pageIndex,
      updatedAt: options.updatedAt,
    });
  }

  /** Upsert a recent file and schedule preview generation from PDF bytes. */
  upsertWithBytesPreview(options: {
    path: string;
    filename: string;
    pdfBytes: Uint8Array;
    lastOpenedAt?: number;
    targetWidth?: number;
    renderAnnotations?: boolean;
    previewUpdatedAt?: number;
    forcePreviewRender?: boolean;
  }) {
    const next = this.upsert({
      path: options.path,
      filename: options.filename,
      lastOpenedAt: options.lastOpenedAt,
    });

    if (!options.forcePreviewRender) {
      const existing = this.getAll().find((e) => e.path === options.path);
      if (existing?.previewDataUrl) {
        return next;
      }
    }

    this.scheduleRecentFilePreviewUpdate({
      path: options.path,
      previewUpdatedAt: options.previewUpdatedAt,
      targetWidth: options.targetWidth,
      renderAnnotations: options.renderAnnotations !== false,
      createPreview: async (signal) => {
        const docId = `recent_preview_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        try {
          const { bytes, mimeType } = await pdfWorkerService.renderPageImage({
            docId,
            data: options.pdfBytes,
            isNewDoc: true,
            pageIndex: 0,
            targetWidth: options.targetWidth ?? 240,
            renderAnnotations: options.renderAnnotations ?? true,
            mimeType: "image/jpeg",
            quality: 0.8,
            priority: 0,
            signal,
          });

          if (!bytes || bytes.length === 0) return null;
          return await this.bytesToDataUrl(bytes, mimeType || "image/jpeg");
        } finally {
          pdfWorkerService.unloadDocument(docId);
        }
      },
    });

    return next;
  }

  /** Whether the Web build has a resumable saved session. */
  hasWebSession(): boolean {
    if (typeof window === "undefined") return false;
    const raw = window.localStorage.getItem(this.WEB_SAVED_SESSION_KEY);
    return raw === "1" || raw === "true";
  }

  /** Update whether the Web build has a resumable saved session. */
  setWebSession(hasSaved: boolean) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      this.WEB_SAVED_SESSION_KEY,
      hasSaved ? "1" : "0",
    );
  }
}

/** Global singleton instance. */
export const recentFilesService = new RecentFilesService();
