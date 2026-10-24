import {
  APP_DB_STORES,
  withAppDb,
  waitForRequest,
  waitForTransaction,
} from "./browserDb";

const MIME = "application/x-legir-pages";
const PREFIX = "Legir pages v1\n";
const STORAGE_KEY = "page-clipboard-v1";
const STORE = APP_DB_STORES.workspace;
type ClipboardRecord = {
  id: string;
  createdAt: number;
  status: "pending" | "ready" | "failed";
  file?: File;
};
let current: { id: string; ready: Promise<File> } | null = null;

const storeRecord = (value: ClipboardRecord, replace = false) =>
  withAppDb(async (db) => {
    const tx = db.transaction(STORE, "readwrite");
    const done = waitForTransaction(tx);
    const store = tx.objectStore(STORE);
    const write = waitForRequest<ClipboardRecord | undefined>(
      store.get(STORAGE_KEY),
    ).then((previous) => {
      // An older export must never overwrite a more recent copy from any window.
      if (
        (replace && (!previous || previous.createdAt <= value.createdAt)) ||
        previous?.id === value.id
      )
        store.put(value, STORAGE_KEY);
    });
    // Observe both failures: a request can reject before its transaction aborts.
    await Promise.all([write, done]);
  });

/** The native clipboard holds a small ticket; the shared DB holds only the
 * latest selected-page PDF. No base64 conversion or full-PDF JSON on keypress. */
export function writePageClipboard(
  data: Pick<DataTransfer, "setData">,
  filename: string,
  exportPages: () => Promise<Blob>,
) {
  const id = crypto.randomUUID();
  const createdAt = performance.timeOrigin + performance.now();
  data.setData("text/plain", PREFIX + id);
  try {
    data.setData(MIME, id);
  } catch {
    /* Standard text is sufficient. */
  }
  // Same-window paste still works if shared storage is unavailable.
  const pending = storeRecord({ id, createdAt, status: "pending" }, true).catch(
    () => {},
  );
  const ready = Promise.resolve()
    .then(exportPages)
    .then(
      async (blob) => {
        const file = new File([blob], filename, { type: "application/pdf" });
        await pending;
        await storeRecord({ id, createdAt, status: "ready", file }).catch(
          () => {},
        );
        return file;
      },
      async (error: unknown) => {
        await pending;
        await storeRecord({ id, createdAt, status: "failed" }).catch(() => {});
        throw error;
      },
    );
  current = { id, ready };
  // Callers can display an error without an unhandled rejection if no paste occurs.
  void ready.catch(() => {});
  return ready;
}

export function readPageClipboardId(
  data: Pick<DataTransfer, "getData">,
): string | null {
  let id = "";
  try {
    id = data.getData(MIME);
  } catch {
    /* Fall back to text. */
  }
  if (!id) {
    const text = data.getData("text/plain");
    if (text.startsWith(PREFIX)) id = text.slice(PREFIX.length);
  }
  return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)
    ? id
    : null;
}

export async function readPageClipboard(
  id: string,
  signal?: AbortSignal,
): Promise<File> {
  signal?.throwIfAborted();
  if (current?.id === id) return current.ready;
  // Another window may still be serializing the selected pages. Its small
  // pending record is replaced atomically once the PDF is ready.
  const deadline = Date.now() + 120_000;
  const pendingDeadline = Date.now() + 1500;
  do {
    signal?.throwIfAborted();
    const record = await withAppDb(async (db) => {
      const tx = db.transaction(STORE, "readonly");
      return await waitForRequest<ClipboardRecord | undefined>(
        tx.objectStore(STORE).get(STORAGE_KEY),
      );
    });
    if (record?.id === id) {
      if (record.status === "ready" && record.file instanceof Blob)
        return new File([record.file], record.file.name || "pages.pdf", {
          type: "application/pdf",
        });
      if (record.status === "failed") break;
    } else if (record || Date.now() >= pendingDeadline) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  } while (Date.now() < deadline);
  throw new Error("Copied pages are no longer available.");
}
