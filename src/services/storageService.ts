import { FormField, PDFMetadata, Annotation } from "../types";

const DB_NAME = "FormForgeDB";
const STORE_NAME = "session";
const KEY = "latest";

export interface DraftData {
  pdfBytes: Uint8Array;
  fields: FormField[];
  annotations: Annotation[];
  metadata: PDFMetadata;
  filename: string;
  updatedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

export async function saveDraft(
  data: Omit<DraftData, "updatedAt">,
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(
      {
        ...data,
        pdfBytes: new Uint8Array(data.pdfBytes),
        updatedAt: Date.now(),
      },
      KEY,
    );
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error("Failed to save draft", e);
  }
}

export async function getDraft(): Promise<DraftData | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(KEY);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve((request.result as DraftData) || null);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error("Failed to get draft", e);
    return null;
  }
}

export async function clearDraft(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(KEY);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error("Failed to clear draft", e);
  }
}
