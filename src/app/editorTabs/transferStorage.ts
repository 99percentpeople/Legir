import {
  createEditorTabSessionTransfer,
  type EditorTabSessionTransfer,
} from "./transfer";
import type { EditorTabSession } from "./types";

const DB_NAME = "LegirEditorTransferDB";
const STORE_NAME = "tab-transfers";
const TRANSFER_TTL_MS = 1000 * 60 * 15;

function openTransferDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {
          keyPath: "transferId",
        });
      }
    };
  });
}

async function purgeExpiredTransfers(db: IDBDatabase) {
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const now = Date.now();

  await new Promise<void>((resolve, reject) => {
    const request = store.openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }

      const value = cursor.value as EditorTabSessionTransfer | undefined;
      if (
        value &&
        typeof value.createdAt === "number" &&
        now - value.createdAt > TRANSFER_TTL_MS
      ) {
        cursor.delete();
      }
      cursor.continue();
    };
  });

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveEditorTabSessionTransfer(
  session: EditorTabSession,
): Promise<EditorTabSessionTransfer> {
  const db = await openTransferDb();
  await purgeExpiredTransfers(db);

  const transfer = createEditorTabSessionTransfer(session);
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  store.put(transfer);

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return transfer;
}

export async function consumeEditorTabSessionTransfer(
  transferId: string,
): Promise<EditorTabSessionTransfer | null> {
  const db = await openTransferDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  const transfer = await new Promise<EditorTabSessionTransfer | null>(
    (resolve, reject) => {
      const request = store.get(transferId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        resolve(
          (request.result as EditorTabSessionTransfer | undefined) ?? null,
        );
      };
    },
  );

  if (transfer) {
    store.delete(transferId);
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return transfer;
}

export async function deleteEditorTabSessionTransfer(transferId: string) {
  const db = await openTransferDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  store.delete(transferId);

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
