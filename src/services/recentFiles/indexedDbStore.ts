import type {
  RecentFileEntry,
  RecentFilesStore,
  RecentFilesStoreListener,
} from "./types";
import {
  APP_DB_STORES,
  withAppDb,
  waitForRequest,
  waitForTransaction,
} from "@/services/browserDb";

const ENTRY_STORE_NAME = APP_DB_STORES.recentFiles;
const HANDLE_STORE_NAME = APP_DB_STORES.recentFileHandles;
const MAX_ENTRIES = 50;
const recentFileListeners = new Set<RecentFilesStoreListener>();

type IndexedDbRecentFileRecord = RecentFileEntry;

type UpsertIndexedDbRecentFileOptions = {
  path?: string;
  handle?: FileSystemFileHandle | null;
  filename: string;
  locationLabel?: string;
  lastOpenedAt?: number;
  previewDataUrl?: string;
  previewUpdatedAt?: number;
};

const toSortedEntries = (entries: RecentFileEntry[]) => {
  return [...entries].sort(
    (left, right) => right.lastOpenedAt - left.lastOpenedAt,
  );
};

const emitRecentFilesChange = (entries: RecentFileEntry[]) => {
  for (const listener of recentFileListeners) {
    try {
      listener(entries);
    } catch (error) {
      console.error("Failed to notify IndexedDB recent file listener", error);
    }
  }
};

const normalizeRecentFileEntry = (
  value: unknown,
): IndexedDbRecentFileRecord | null => {
  if (!value || typeof value !== "object") return null;

  const entry = value as Partial<IndexedDbRecentFileRecord>;
  const path = typeof entry.path === "string" ? entry.path : "";
  const filename = typeof entry.filename === "string" ? entry.filename : "";
  const lastOpenedAt = Number(entry.lastOpenedAt ?? 0);

  if (!path || !filename || !Number.isFinite(lastOpenedAt)) return null;

  return {
    path,
    filename,
    locationLabel:
      typeof entry.locationLabel === "string" ? entry.locationLabel : filename,
    lastOpenedAt,
    previewDataUrl:
      typeof entry.previewDataUrl === "string"
        ? entry.previewDataUrl
        : undefined,
    previewUpdatedAt:
      typeof entry.previewUpdatedAt === "number"
        ? Number(entry.previewUpdatedAt)
        : undefined,
  };
};

const readEntries = async (): Promise<RecentFileEntry[]> => {
  try {
    return await withAppDb(async (db) => {
      const tx = db.transaction(ENTRY_STORE_NAME, "readonly");
      const txDone = waitForTransaction(tx);
      const store = tx.objectStore(ENTRY_STORE_NAME);
      const result = await waitForRequest(store.getAll());
      await txDone;

      if (!Array.isArray(result)) return [];

      return toSortedEntries(
        result
          .map((entry) => normalizeRecentFileEntry(entry))
          .filter((entry): entry is RecentFileEntry => entry !== null),
      );
    });
  } catch (error) {
    console.error("Failed to read IndexedDB recent files", error);
    return [];
  }
};

const deleteEntries = async (paths: string[]) => {
  if (paths.length === 0) return;

  await withAppDb(async (db) => {
    const tx = db.transaction(
      [ENTRY_STORE_NAME, HANDLE_STORE_NAME],
      "readwrite",
    );
    const entryStore = tx.objectStore(ENTRY_STORE_NAME);
    const handleStore = tx.objectStore(HANDLE_STORE_NAME);

    for (const path of paths) {
      entryStore.delete(path);
      handleStore.delete(path);
    }

    await waitForTransaction(tx);
  });
  emitRecentFilesChange(await readEntries());
};

const clearEntries = async () => {
  await withAppDb(async (db) => {
    const tx = db.transaction(
      [ENTRY_STORE_NAME, HANDLE_STORE_NAME],
      "readwrite",
    );
    tx.objectStore(ENTRY_STORE_NAME).clear();
    tx.objectStore(HANDLE_STORE_NAME).clear();
    await waitForTransaction(tx);
  });
  emitRecentFilesChange([]);
};

const writeEntry = async (
  entry: RecentFileEntry,
  handle?: FileSystemFileHandle | null,
) => {
  await withAppDb(async (db) => {
    const tx = db.transaction(
      [ENTRY_STORE_NAME, HANDLE_STORE_NAME],
      "readwrite",
    );
    tx.objectStore(ENTRY_STORE_NAME).put(entry, entry.path);
    if (handle) {
      tx.objectStore(HANDLE_STORE_NAME).put(handle, entry.path);
    }
    await waitForTransaction(tx);
  });
};

const readHandleRecords = async (): Promise<
  Array<{ path: string; handle: FileSystemFileHandle }>
> => {
  return await withAppDb(async (db) => {
    const tx = db.transaction(HANDLE_STORE_NAME, "readonly");
    const txDone = waitForTransaction(tx);
    const store = tx.objectStore(HANDLE_STORE_NAME);
    const [keys, handles] = await Promise.all([
      waitForRequest(store.getAllKeys()),
      waitForRequest(store.getAll()),
    ]);
    await txDone;

    return keys.flatMap((key, index) => {
      const handle = handles[index];
      return typeof key === "string" && handle ? [{ path: key, handle }] : [];
    });
  });
};

const createRecentFileKey = (filename: string) => {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `web:${Date.now()}:${suffix}:${filename}`;
};

const findRecentFilePathByHandle = async (target: FileSystemFileHandle) => {
  try {
    const records = await readHandleRecords();
    for (const record of records) {
      try {
        if (await record.handle.isSameEntry(target)) {
          return record.path;
        }
      } catch {
        // Ignore stale or revoked handles and keep searching.
      }
    }
  } catch (error) {
    console.error("Failed to compare IndexedDB recent file handles", error);
  }

  return null;
};

export const getIndexedDbRecentFileHandle = async (path: string) => {
  try {
    return await withAppDb(async (db) => {
      const tx = db.transaction(HANDLE_STORE_NAME, "readonly");
      const txDone = waitForTransaction(tx);
      const store = tx.objectStore(HANDLE_STORE_NAME);
      const handle = await waitForRequest<FileSystemFileHandle | undefined>(
        store.get(path),
      );
      await txDone;
      return handle ?? null;
    });
  } catch (error) {
    console.error("Failed to load IndexedDB recent file handle", error);
    return null;
  }
};

export const upsertIndexedDbRecentFile = async (
  options: UpsertIndexedDbRecentFileOptions,
) => {
  const existingPath = options.handle
    ? await findRecentFilePathByHandle(options.handle)
    : null;
  const path =
    options.path ?? existingPath ?? createRecentFileKey(options.filename);
  const entries = await readEntries();
  const previous = entries.find((entry) => entry.path === path);

  const nextEntry: RecentFileEntry = {
    path,
    filename: options.filename,
    locationLabel:
      options.locationLabel ?? previous?.locationLabel ?? options.filename,
    lastOpenedAt: options.lastOpenedAt ?? Date.now(),
    previewDataUrl: options.previewDataUrl ?? previous?.previewDataUrl,
    previewUpdatedAt: options.previewUpdatedAt ?? previous?.previewUpdatedAt,
  };

  await writeEntry(nextEntry, options.handle);

  const trimmedEntries = toSortedEntries([
    nextEntry,
    ...entries.filter((entry) => entry.path !== path),
  ]).slice(0, MAX_ENTRIES);
  const overflowPaths = entries
    .filter((entry) => !trimmedEntries.some((item) => item.path === entry.path))
    .map((entry) => entry.path);

  if (overflowPaths.length > 0) {
    await deleteEntries(overflowPaths);
  }

  emitRecentFilesChange(trimmedEntries);
  return trimmedEntries;
};

export const createIndexedDbRecentFilesStore = (): RecentFilesStore => ({
  list: async () => await readEntries(),
  remove: async (path) => {
    await deleteEntries([path]);
    return await readEntries();
  },
  clear: async () => {
    await clearEntries();
    return [];
  },
  upsert: async (entry) => {
    return await upsertIndexedDbRecentFile(entry);
  },
  subscribe: (listener) => {
    recentFileListeners.add(listener);
    return () => {
      recentFileListeners.delete(listener);
    };
  },
});
