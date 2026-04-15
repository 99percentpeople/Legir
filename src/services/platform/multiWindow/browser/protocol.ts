import type { EditorWindowId } from "@/app/editorTabs/types";

export const BROWSER_WINDOW_ID_QUERY_KEY = "appWindowId";
export const BROWSER_WINDOW_ID_STORAGE_KEY = "app-window-id";
export const BROWSER_PLATFORM_CHANNEL_NAME = "legir-browser-platform";
export const INTERNAL_WINDOW_FOCUS_CHANNEL = "platform-window-focus";
export const WINDOW_HEARTBEAT_INTERVAL_MS = 5_000;
export const WINDOW_STALE_TTL_MS = 20_000;

export const SERVICE_WORKER_DISCOVERY_PROBE = "platform-window-discovery-probe";
export const SERVICE_WORKER_DISCOVERY_REPORT =
  "platform-window-discovery-report";
export const SERVICE_WORKER_REGISTRY_LIST_REQUEST =
  "platform-window-registry-list-request";
export const SERVICE_WORKER_REGISTRY_UPSERT_REQUEST =
  "platform-window-registry-upsert-request";
export const SERVICE_WORKER_REGISTRY_REMOVE_REQUEST =
  "platform-window-registry-remove-request";
export const SERVICE_WORKER_REGISTRY_CHANGED =
  "platform-window-registry-changed";

export type BrowserPlatformWindowRecord = {
  windowId: EditorWindowId;
  title: string | null;
  sourceKeys: string[];
  updatedAt: number;
};

export type BrowserPlatformMessageEnvelope<T> = {
  channel: string;
  sourceWindowId: EditorWindowId;
  targetWindowId?: EditorWindowId;
  payload: T;
};

export type BrowserPlatformBroadcastEnvelope<T> = {
  kind: "channel-message";
  message: BrowserPlatformMessageEnvelope<T>;
};

export type ServiceWorkerDiscoveryProbeMessage = {
  type: typeof SERVICE_WORKER_DISCOVERY_PROBE;
  requestId: string;
};

export type ServiceWorkerDiscoveryReportMessage = {
  type: typeof SERVICE_WORKER_DISCOVERY_REPORT;
  requestId: string;
  record: BrowserPlatformWindowRecord;
};

export type ServiceWorkerDiscoveryResponseMessage = {
  requestId: string;
  records: BrowserPlatformWindowRecord[];
};

export type ServiceWorkerRegistryListRequestMessage = {
  type: typeof SERVICE_WORKER_REGISTRY_LIST_REQUEST;
  requestId: string;
};

export type ServiceWorkerRegistryUpsertRequestMessage = {
  type: typeof SERVICE_WORKER_REGISTRY_UPSERT_REQUEST;
  requestId?: string;
  record: BrowserPlatformWindowRecord;
};

export type ServiceWorkerRegistryRemoveRequestMessage = {
  type: typeof SERVICE_WORKER_REGISTRY_REMOVE_REQUEST;
  requestId?: string;
  windowId: EditorWindowId;
};

export type ServiceWorkerRegistryChangedMessage = {
  type: typeof SERVICE_WORKER_REGISTRY_CHANGED;
  sourceWindowId?: EditorWindowId;
};

export type ServiceWorkerRegistryResponseMessage = {
  requestId: string;
  ok: boolean;
  records?: BrowserPlatformWindowRecord[];
};
