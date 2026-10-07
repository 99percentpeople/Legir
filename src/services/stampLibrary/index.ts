import {
  APP_DB_STORES,
  waitForRequest,
  waitForTransaction,
  withAppDb,
} from "@/services/browserDb";
import type { StampImageResource } from "@/types";
import type { StampLibraryEntry } from "./types";
import CryptoJS from "crypto-js";

const KEY_PREFIX = "stamp-image:";
const STORE = APP_DB_STORES.workspace;

export const compareStampLibraryEntries = (
  a: StampLibraryEntry,
  b: StampLibraryEntry,
) => (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt);

export const readStampLibrary = () =>
  withAppDb(async (db) => {
    const tx = db.transaction(STORE, "readonly");
    const done = waitForTransaction(tx);
    const entries = await waitForRequest<StampLibraryEntry[]>(
      tx
        .objectStore(STORE)
        .getAll(IDBKeyRange.bound(KEY_PREFIX, `${KEY_PREFIX}\uffff`)),
    );
    await done;
    return entries.sort(compareStampLibraryEntries);
  });

export const saveStampLibraryImage = async (
  name: string,
  image: StampImageResource,
  file?: File,
) => {
  // File imports only compare inexpensive metadata, not image contents.
  const id = file
    ? `file:${JSON.stringify([
        file.webkitRelativePath || file.name,
        file.size,
        file.lastModified,
      ])}`
    : CryptoJS.SHA256(
        CryptoJS.lib.WordArray.create(new TextEncoder().encode(image.dataUrl)),
      ).toString();
  return withAppDb(async (db) => {
    const tx = db.transaction(STORE, "readwrite");
    const done = waitForTransaction(tx);
    const store = tx.objectStore(STORE);
    const key = `${KEY_PREFIX}${id}`;
    const existing = await waitForRequest<StampLibraryEntry | undefined>(
      store.get(key),
    );
    const entry = {
      ...(existing ?? { id, name, image, createdAt: Date.now() }),
      lastUsedAt: Date.now(),
    };
    store.put(entry, key);
    await done;
    return entry;
  });
};

export const markStampLibraryImageUsed = (id: string) =>
  withAppDb(async (db) => {
    const tx = db.transaction(STORE, "readwrite");
    const done = waitForTransaction(tx);
    const store = tx.objectStore(STORE);
    const key = `${KEY_PREFIX}${id}`;
    const entry = await waitForRequest<StampLibraryEntry | undefined>(
      store.get(key),
    );
    if (entry) {
      entry.lastUsedAt = Date.now();
      store.put(entry, key);
    }
    await done;
    return entry;
  });

export const deleteStampLibraryImage = (id: string) =>
  withAppDb(async (db) => {
    const tx = db.transaction(STORE, "readwrite");
    const done = waitForTransaction(tx);
    tx.objectStore(STORE).delete(`${KEY_PREFIX}${id}`);
    await done;
  });
