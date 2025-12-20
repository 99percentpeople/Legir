export type RecentFileEntry = {
  path: string;
  filename: string;
  lastOpenedAt: number;
  thumbnailDataUrl?: string;
  thumbnailUpdatedAt?: number;
};

const STORAGE_KEY = "ff-recent-files";
const MAX_ENTRIES = 50;

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
        thumbnailDataUrl:
          typeof x.thumbnailDataUrl === "string"
            ? String(x.thumbnailDataUrl)
            : undefined,
        thumbnailUpdatedAt:
          typeof x.thumbnailUpdatedAt === "number"
            ? Number(x.thumbnailUpdatedAt)
            : undefined,
      }))
      .filter((x) => x.path && x.filename && Number.isFinite(x.lastOpenedAt));
  } catch {
    return [];
  }
};

export const getRecentFiles = (): RecentFileEntry[] => {
  if (typeof window === "undefined") return [];
  const items = safeParse(window.localStorage.getItem(STORAGE_KEY));
  return items.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
};

export const setRecentFiles = (entries: RecentFileEntry[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
};

export const addRecentFile = (entry: {
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
      thumbnailDataUrl: previous?.thumbnailDataUrl,
      thumbnailUpdatedAt: previous?.thumbnailUpdatedAt,
    },
    ...filtered,
  ].slice(0, MAX_ENTRIES);
  setRecentFiles(next);
  return next;
};

export const setRecentFileThumbnail = (options: {
  path: string;
  thumbnailDataUrl: string;
  thumbnailUpdatedAt?: number;
}) => {
  const current = getRecentFiles();
  const now = options.thumbnailUpdatedAt ?? Date.now();

  const next = current.map((e) =>
    e.path === options.path
      ? {
          ...e,
          thumbnailDataUrl: options.thumbnailDataUrl,
          thumbnailUpdatedAt: now,
        }
      : e,
  );
  setRecentFiles(next);
  return next;
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
