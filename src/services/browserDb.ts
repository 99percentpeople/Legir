const APP_DB_NAME = "LegirAppDB";
const APP_DB_VERSION = 1;

const LEGACY_DB_NAMES = [
  "LegirLandingDB",
  "LegirDB",
  "LegirEditorTransferDB",
] as const;

export const APP_DB_STORES = {
  workspace: "workspace",
  tabTransfers: "tab-transfers",
  recentFiles: "recent-files",
  recentFileHandles: "recent-file-handles",
} as const;

type AppDbStoreName = (typeof APP_DB_STORES)[keyof typeof APP_DB_STORES];
let appDbPromise: Promise<IDBDatabase> | null = null;

const createStoreIfMissing = (
  db: IDBDatabase,
  name: AppDbStoreName,
  options?: IDBObjectStoreParameters,
) => {
  if (db.objectStoreNames.contains(name)) return;
  db.createObjectStore(name, options);
};

const createAppDbConnection = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(APP_DB_NAME, APP_DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      createStoreIfMissing(db, APP_DB_STORES.workspace);
      createStoreIfMissing(db, APP_DB_STORES.recentFiles);
      createStoreIfMissing(db, APP_DB_STORES.recentFileHandles);
      createStoreIfMissing(db, APP_DB_STORES.tabTransfers, {
        keyPath: "transferId",
      });
    };
  });

const deleteDb = (name: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });

let legacyCleanupPromise: Promise<void> | null = null;

export const cleanupLegacyAppDbs = () => {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  if (legacyCleanupPromise) return legacyCleanupPromise;

  legacyCleanupPromise = Promise.allSettled(
    LEGACY_DB_NAMES.map(async (name) => {
      await deleteDb(name);
    }),
  ).then(() => undefined);

  return legacyCleanupPromise;
};

export const openAppDb = () => {
  if (appDbPromise) return appDbPromise;

  appDbPromise = cleanupLegacyAppDbs()
    .catch((error) => {
      console.error("Failed to cleanup legacy IndexedDB databases", error);
    })
    .then(() => createAppDbConnection())
    .catch((error) => {
      appDbPromise = null;
      throw error;
    });

  return appDbPromise;
};

export const withAppDb = async <T>(
  run: (db: IDBDatabase) => Promise<T>,
): Promise<T> => {
  const db = await openAppDb();
  return await run(db);
};

export const waitForRequest = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const waitForTransaction = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
