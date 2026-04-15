import type { EditorWindowId } from "@/app/editorTabs/types";
import {
  APP_DB_STORES,
  waitForRequest,
  waitForTransaction,
  withAppDb,
} from "@/services/browserDb";
import type { BrowserPlatformWindowRecord } from "./protocol";

const BROWSER_PLATFORM_WINDOWS_STORE_NAME = APP_DB_STORES.workspace;
const BROWSER_PLATFORM_WINDOWS_REGISTRY_KEY =
  "browser-platform-window-registry";

export const normalizeBrowserPlatformWindowId = (value: unknown) => {
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (!normalized) return null;

  return normalized.replace(/[^a-zA-Z0-9:_-]/g, "_");
};

export const normalizeBrowserPlatformSourceKeys = (value: unknown) => {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0),
    ),
  );
};

export const normalizeBrowserPlatformWindowRecord = (
  value: unknown,
): BrowserPlatformWindowRecord | null => {
  if (!value || typeof value !== "object") return null;

  const raw = value as Partial<BrowserPlatformWindowRecord>;
  const windowId = normalizeBrowserPlatformWindowId(raw.windowId);
  if (!windowId) return null;

  const updatedAt = Number(raw.updatedAt ?? 0);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return null;
  }

  return {
    windowId,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : null,
    sourceKeys: normalizeBrowserPlatformSourceKeys(raw.sourceKeys),
    updatedAt,
  };
};

export const getBrowserPlatformWindowRegistrySignature = (
  records: BrowserPlatformWindowRecord[],
) => {
  return [...records]
    .map((record) => ({
      sourceKeys: [...record.sourceKeys].sort((left, right) =>
        left.localeCompare(right),
      ),
      title: record.title ?? "",
      windowId: record.windowId,
    }))
    .sort((left, right) => left.windowId.localeCompare(right.windowId))
    .map(
      (record) =>
        `${record.windowId}|${record.title}|${record.sourceKeys.join(",")}`,
    )
    .join("\n");
};

export const listStoredBrowserPlatformWindowRecords = async (): Promise<
  BrowserPlatformWindowRecord[]
> => {
  try {
    return await withAppDb(async (db) => {
      const tx = db.transaction(
        BROWSER_PLATFORM_WINDOWS_STORE_NAME,
        "readonly",
      );
      const txDone = waitForTransaction(tx);
      const store = tx.objectStore(BROWSER_PLATFORM_WINDOWS_STORE_NAME);
      const result = await waitForRequest(
        store.get(BROWSER_PLATFORM_WINDOWS_REGISTRY_KEY),
      );
      await txDone;

      if (!Array.isArray(result)) {
        return [];
      }

      return result
        .map((item) => normalizeBrowserPlatformWindowRecord(item))
        .filter(
          (record): record is BrowserPlatformWindowRecord => record !== null,
        );
    });
  } catch (error) {
    console.error("Failed to load browser platform windows", error);
    return [];
  }
};

export const putStoredBrowserPlatformWindowRecord = async (
  record: BrowserPlatformWindowRecord,
) => {
  const normalized = normalizeBrowserPlatformWindowRecord(record);
  if (!normalized) return;

  const records = await listStoredBrowserPlatformWindowRecords();
  const nextRecords = [
    normalized,
    ...records.filter((item) => item.windowId !== normalized.windowId),
  ];

  await withAppDb(async (db) => {
    const tx = db.transaction(BROWSER_PLATFORM_WINDOWS_STORE_NAME, "readwrite");
    tx.objectStore(BROWSER_PLATFORM_WINDOWS_STORE_NAME).put(
      nextRecords,
      BROWSER_PLATFORM_WINDOWS_REGISTRY_KEY,
    );
    await waitForTransaction(tx);
  });
};

export const upsertStoredBrowserPlatformWindowRecords = async (
  records: BrowserPlatformWindowRecord[],
) => {
  const normalizedRecords = records
    .map((record) => normalizeBrowserPlatformWindowRecord(record))
    .filter((record): record is BrowserPlatformWindowRecord => record !== null);

  if (normalizedRecords.length === 0) {
    return;
  }

  const currentRecords = await listStoredBrowserPlatformWindowRecords();
  const nextRecordsById = new Map(
    currentRecords.map((record) => [record.windowId, record] as const),
  );

  for (const record of normalizedRecords) {
    nextRecordsById.set(record.windowId, record);
  }

  await withAppDb(async (db) => {
    const tx = db.transaction(BROWSER_PLATFORM_WINDOWS_STORE_NAME, "readwrite");
    const store = tx.objectStore(BROWSER_PLATFORM_WINDOWS_STORE_NAME);
    store.put(
      [...nextRecordsById.values()],
      BROWSER_PLATFORM_WINDOWS_REGISTRY_KEY,
    );

    await waitForTransaction(tx);
  });
};

export const deleteStoredBrowserPlatformWindowRecords = async (
  windowIds: EditorWindowId[],
) => {
  const normalizedWindowIds = Array.from(
    new Set(
      windowIds
        .map((windowId) => normalizeBrowserPlatformWindowId(windowId))
        .filter((windowId): windowId is EditorWindowId => windowId !== null),
    ),
  );
  if (normalizedWindowIds.length === 0) {
    return;
  }

  const records = await listStoredBrowserPlatformWindowRecords();
  const nextRecords = records.filter(
    (record) => !normalizedWindowIds.includes(record.windowId),
  );

  await withAppDb(async (db) => {
    const tx = db.transaction(BROWSER_PLATFORM_WINDOWS_STORE_NAME, "readwrite");
    const store = tx.objectStore(BROWSER_PLATFORM_WINDOWS_STORE_NAME);
    store.put(nextRecords, BROWSER_PLATFORM_WINDOWS_REGISTRY_KEY);

    await waitForTransaction(tx);
  });
};
