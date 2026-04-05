import type {
  RecentFileEntry,
  RecentFilesStoreListener,
} from "./recentFiles/types";
import { renderPdfPreviewDataUrl } from "./recentFilePreview";

type PreviewTaskKey = string;

/**
 * Single authoritative service for:
 * - Tauri recent files persistence (localStorage)
 * - Preview thumbnail generation (serialized queue + de-dupe + cancellation)
 */
export class RecentFilesService {
  private readonly STORAGE_KEY = "app-recent-files";
  private readonly MAX_ENTRIES = 50;
  private listeners = new Set<RecentFilesStoreListener>();

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
          locationLabel:
            typeof x.locationLabel === "string"
              ? String(x.locationLabel)
              : String(x.path ?? ""),
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
        }))
        .filter((x) => x.path && x.filename && Number.isFinite(x.lastOpenedAt));
    } catch {
      return [];
    }
  }

  private setRecentFiles(entries: RecentFileEntry[]) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(this.STORAGE_KEY, JSON.stringify(entries));
    this.emitChange(entries);
  }

  private emitChange(entries: RecentFileEntry[]) {
    for (const listener of this.listeners) {
      try {
        listener(entries);
      } catch (error) {
        console.error("Failed to notify recent file listener", error);
      }
    }
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
  upsert(entry: {
    path: string;
    filename: string;
    locationLabel?: string;
    lastOpenedAt?: number;
  }) {
    const now = entry.lastOpenedAt ?? Date.now();
    const current = this.getAll();
    const filtered = current.filter((e) => e.path !== entry.path);
    const previous = current.find((e) => e.path === entry.path);
    const next: RecentFileEntry[] = [
      {
        path: entry.path,
        filename: entry.filename,
        locationLabel: entry.locationLabel ?? entry.path,
        lastOpenedAt: now,
        previewDataUrl: previous?.previewDataUrl,
        previewUpdatedAt: previous?.previewUpdatedAt,
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

  subscribe(listener: RecentFilesStoreListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
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
        return await renderPdfPreviewDataUrl({
          pdfBytes: options.pdfBytes,
          targetWidth: options.targetWidth ?? 240,
          renderAnnotations: options.renderAnnotations ?? true,
          signal,
        });
      },
    });

    return next;
  }
}

/** Global singleton instance. */
export const recentFilesService = new RecentFilesService();
