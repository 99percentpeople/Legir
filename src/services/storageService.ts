import type { PersistedEditorWorkspaceDraft } from "@/app/editorTabs/persistence";

const DB_NAME = "FormForgeDB";
const STORE_NAME = "session";
// Cleanup key for the pre-workspace web draft format.
const LEGACY_DRAFT_KEY = "latest";
const WORKSPACE_KEY = "workspace";

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

export async function saveWorkspaceDraft(
  draft: PersistedEditorWorkspaceDraft,
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(draft, WORKSPACE_KEY);
    store.delete(LEGACY_DRAFT_KEY);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error("Failed to save workspace draft", e);
  }
}

export async function getWorkspaceDraft(): Promise<PersistedEditorWorkspaceDraft | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(WORKSPACE_KEY);
    return new Promise((resolve, reject) => {
      request.onsuccess = () =>
        resolve((request.result as PersistedEditorWorkspaceDraft) || null);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error("Failed to get workspace draft", e);
    return null;
  }
}

export async function clearWorkspaceDraft(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(WORKSPACE_KEY);
    store.delete(LEGACY_DRAFT_KEY);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error("Failed to clear workspace draft", e);
  }
}
