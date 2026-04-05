import {
  createEditorTabSessionTransfer,
  type EditorTabSessionTransfer,
} from "./transfer";
import type { EditorTabSession } from "./types";
import {
  APP_DB_STORES,
  withAppDb,
  waitForRequest,
  waitForTransaction,
} from "@/services/browserDb";

const STORE_NAME = APP_DB_STORES.tabTransfers;
const TRANSFER_TTL_MS = 1000 * 60 * 15;

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

  await waitForTransaction(tx);
}

export async function saveEditorTabSessionTransfer(
  session: EditorTabSession,
): Promise<EditorTabSessionTransfer> {
  return await withAppDb(async (db) => {
    await purgeExpiredTransfers(db);

    const transfer = createEditorTabSessionTransfer(session);
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(transfer);

    await waitForTransaction(tx);

    return transfer;
  });
}

export async function consumeEditorTabSessionTransfer(
  transferId: string,
): Promise<EditorTabSessionTransfer | null> {
  return await withAppDb(async (db) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const transfer =
      ((await waitForRequest(store.get(transferId))) as
        | EditorTabSessionTransfer
        | undefined) ?? null;

    if (transfer) {
      store.delete(transferId);
    }

    await waitForTransaction(tx);

    return transfer;
  });
}

export async function deleteEditorTabSessionTransfer(transferId: string) {
  await withAppDb(async (db) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(transferId);

    await waitForTransaction(tx);
  });
}
