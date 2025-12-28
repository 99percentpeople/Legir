import { renderPdfThumbnailFromPdfBytes } from "./pdfService";

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

const STORAGE_KEY = "ff-recent-files";
const WEB_SAVED_SESSION_KEY = "ff-web-has-saved-session";
const WEB_DRAFT_VIEW_STATE_KEY = "ff-web-draft-view-state";
const MAX_ENTRIES = 50;

let previewQueue: Promise<void> = Promise.resolve();

const safeParse = (raw: string | null): RecentFileEntry[] => {
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
                    ? Math.max(0, Math.floor(Number(x.lastViewState.pageIndex)))
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
};

export const getRecentFiles = (): RecentFileEntry[] => {
  if (typeof window === "undefined") return [];
  const items = safeParse(window.localStorage.getItem(STORAGE_KEY));
  return items.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
};

const setRecentFiles = (entries: RecentFileEntry[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
};

const upsertRecentFile = (entry: {
  path: string;
  filename: string;
  lastOpenedAt?: number;
}) => {
  const now = entry.lastOpenedAt ?? Date.now();
  const current = getRecentFiles();
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
  ].slice(0, MAX_ENTRIES);
  setRecentFiles(next);
  return next;
};

export const persistTauriRecentFileViewStateFromDom = (options: {
  path: string;
  scale: number;
  pageIndex?: number;
  selector?: string;
  updatedAt?: number;
}) => {
  if (typeof document === "undefined") return;
  const el = document.querySelector(
    options.selector ?? "[data-workspace-scroll-container='true']",
  ) as HTMLElement | null;
  if (!el) return;
  setRecentFileViewState({
    path: options.path,
    scale: options.scale,
    scrollLeft: el.scrollLeft,
    scrollTop: el.scrollTop,
    pageIndex: options.pageIndex,
    updatedAt: options.updatedAt,
  });
};

const setRecentFilePreview = (options: {
  path: string;
  previewDataUrl: string;
  previewUpdatedAt?: number;
}) => {
  const current = getRecentFiles();
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
  setRecentFiles(next);
  return next;
};

export const upsertRecentFileWithPreviewFromPdfBytes = (options: {
  path: string;
  filename: string;
  pdfBytes: Uint8Array;
  lastOpenedAt?: number;
  targetWidth?: number;
  renderAnnotations?: boolean;
  previewUpdatedAt?: number;
}) => {
  const next = upsertRecentFile({
    path: options.path,
    filename: options.filename,
    lastOpenedAt: options.lastOpenedAt,
  });

  previewQueue = previewQueue
    .catch(() => {
      // keep queue alive
    })
    .then(async () => {
      try {
        const thumb = await renderPdfThumbnailFromPdfBytes({
          pdfBytes: options.pdfBytes,
          targetWidth: options.targetWidth ?? 240,
          renderAnnotations: options.renderAnnotations,
        });
        if (!thumb) return;
        setRecentFilePreview({
          path: options.path,
          previewDataUrl: thumb,
          previewUpdatedAt: options.previewUpdatedAt,
        });
      } catch {
        // ignore
      }
    });

  return next;
};

export const waitForRecentFilePreviewQueue = () => {
  return previewQueue;
};

const getRecentFileByPath = (path: string): RecentFileEntry | null => {
  const current = getRecentFiles();
  return current.find((e) => e.path === path) ?? null;
};

export const getRecentFileViewState = (path: string) => {
  return getRecentFileByPath(path)?.lastViewState ?? null;
};

function setRecentFileViewState(options: {
  path: string;
  scale: number;
  scrollLeft: number;
  scrollTop: number;
  updatedAt?: number;
  pageIndex?: number;
}) {
  const current = getRecentFiles();
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
  setRecentFiles(next);
  return next;
}

export const getWebHasSavedSession = (): boolean => {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(WEB_SAVED_SESSION_KEY);
  return raw === "1" || raw === "true";
};

export const setWebHasSavedSession = (hasSaved: boolean) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WEB_SAVED_SESSION_KEY, hasSaved ? "1" : "0");
};

export const getWebDraftViewState = (): {
  scale: number;
  scrollLeft: number;
  scrollTop: number;
  updatedAt: number;
} | null => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(WEB_DRAFT_VIEW_STATE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const scale = Number((parsed as any).scale ?? 0);
    const scrollLeft = Number((parsed as any).scrollLeft ?? 0);
    const scrollTop = Number((parsed as any).scrollTop ?? 0);
    const updatedAt = Number((parsed as any).updatedAt ?? 0);
    if (
      !Number.isFinite(scale) ||
      !Number.isFinite(scrollLeft) ||
      !Number.isFinite(scrollTop) ||
      !Number.isFinite(updatedAt)
    ) {
      return null;
    }
    return { scale, scrollLeft, scrollTop, updatedAt };
  } catch {
    return null;
  }
};

export const setWebDraftViewState = (options: {
  scale: number;
  scrollLeft: number;
  scrollTop: number;
  updatedAt?: number;
}) => {
  if (typeof window === "undefined") return;
  const now = options.updatedAt ?? Date.now();
  window.localStorage.setItem(
    WEB_DRAFT_VIEW_STATE_KEY,
    JSON.stringify({
      scale: options.scale,
      scrollLeft: options.scrollLeft,
      scrollTop: options.scrollTop,
      updatedAt: now,
    }),
  );
};

export const persistWebDraftViewStateFromDom = (options: {
  scale: number;
  selector?: string;
  updatedAt?: number;
}) => {
  if (typeof document === "undefined") return;
  const el = document.querySelector(
    options.selector ?? "[data-workspace-scroll-container='true']",
  ) as HTMLElement | null;
  if (!el) return;
  setWebDraftViewState({
    scale: options.scale,
    scrollLeft: el.scrollLeft,
    scrollTop: el.scrollTop,
    updatedAt: options.updatedAt,
  });
};

export const removeRecentFile = (path: string) => {
  const current = getRecentFiles();
  const next = current.filter((e) => e.path !== path);
  setRecentFiles(next);
  return next;
};

export const clearRecentFiles = () => {
  setRecentFiles([]);
  return [] as RecentFileEntry[];
};
