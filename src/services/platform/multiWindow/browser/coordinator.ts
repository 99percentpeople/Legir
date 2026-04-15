import type { EditorWindowId } from "@/app/editorTabs/types";
import {
  BROWSER_PLATFORM_CHANNEL_NAME,
  BROWSER_WINDOW_ID_QUERY_KEY,
  BROWSER_WINDOW_ID_STORAGE_KEY,
  INTERNAL_WINDOW_FOCUS_CHANNEL,
  SERVICE_WORKER_DISCOVERY_PROBE,
  SERVICE_WORKER_DISCOVERY_REPORT,
  SERVICE_WORKER_REGISTRY_CHANGED,
  SERVICE_WORKER_REGISTRY_LIST_REQUEST,
  SERVICE_WORKER_REGISTRY_REMOVE_REQUEST,
  SERVICE_WORKER_REGISTRY_UPSERT_REQUEST,
  WINDOW_HEARTBEAT_INTERVAL_MS,
  type BrowserPlatformBroadcastEnvelope,
  type BrowserPlatformMessageEnvelope,
  type BrowserPlatformWindowRecord,
  type ServiceWorkerDiscoveryProbeMessage,
  type ServiceWorkerDiscoveryReportMessage,
  type ServiceWorkerRegistryChangedMessage,
  type ServiceWorkerRegistryListRequestMessage,
  type ServiceWorkerRegistryRemoveRequestMessage,
  type ServiceWorkerRegistryResponseMessage,
  type ServiceWorkerRegistryUpsertRequestMessage,
} from "./protocol";
import {
  getBrowserPlatformWindowRegistrySignature,
  normalizeBrowserPlatformSourceKeys,
  normalizeBrowserPlatformWindowId,
  normalizeBrowserPlatformWindowRecord,
} from "./store";
import {
  isInstalledPwa,
  subscribePlatformRuntimeChange,
  supportsPlatformMultiWindow,
} from "../../runtime";

type BrowserPlatformMessageListener = (
  envelope: BrowserPlatformMessageEnvelope<unknown>,
) => void;

type OpenBrowserPlatformWindowOptions = {
  windowId: EditorWindowId;
  route: string;
  focus?: boolean;
  inheritCurrentWindowState?: boolean;
};

type ServiceWorkerRequestMessage =
  | ServiceWorkerRegistryListRequestMessage
  | ServiceWorkerRegistryUpsertRequestMessage
  | ServiceWorkerRegistryRemoveRequestMessage
  | ServiceWorkerDiscoveryReportMessage;

type ServiceWorkerReplyRequestMessage =
  | ServiceWorkerRegistryListRequestMessage
  | (ServiceWorkerRegistryUpsertRequestMessage & { requestId: string })
  | (ServiceWorkerRegistryRemoveRequestMessage & { requestId: string });

let cachedBrowserWindowId: EditorWindowId | null = null;
let cachedBroadcastChannel: BroadcastChannel | null = null;
let broadcastChannelBound = false;
let currentWindowState: BrowserPlatformWindowRecord | null = null;
let browserWindowLifecycleStarted = false;
let browserWindowHeartbeatId: number | null = null;
let browserWindowLifecycleCleanup: (() => void) | null = null;
let browserRuntimeSyncStarted = false;
let serviceWorkerBridgeBound = false;
let registryMutationQueue = Promise.resolve();
let registryRefreshPromise: Promise<void> | null = null;
let lastRegistrySignature = "";

const browserMessageListeners = new Map<
  string,
  Set<BrowserPlatformMessageListener>
>();
const browserWindowRegistryListeners = new Set<() => void>();

const SERVICE_WORKER_RESPONSE_TIMEOUT_MS = 750;

const createBrowserWindowId = () =>
  `browser_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const createServiceWorkerRequestId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const sortBrowserPlatformWindows = (records: BrowserPlatformWindowRecord[]) => {
  return [...records].sort((left, right) =>
    left.windowId.localeCompare(right.windowId),
  );
};

const notifyBrowserWindowRegistryListeners = () => {
  for (const listener of browserWindowRegistryListeners) {
    try {
      listener();
    } catch (error) {
      console.error("Failed to notify browser window registry listener", error);
    }
  }
};

const enqueueRegistryMutation = <T>(run: () => Promise<T>) => {
  const nextPromise = registryMutationQueue.then(run, run);
  registryMutationQueue = nextPromise.then(
    () => undefined,
    () => undefined,
  );
  return nextPromise;
};

const getBrowserBaseUrl = () => {
  const base = import.meta.env.BASE_URL || "/";
  return new URL(base, window.location.origin);
};

const buildBrowserWindowUrl = (route: string, windowId: EditorWindowId) => {
  const url = getBrowserBaseUrl();
  const normalizedRoute = route.trim() || "/";

  if (normalizedRoute.startsWith("/?")) {
    const hashIndex = normalizedRoute.indexOf("#");
    if (hashIndex >= 0) {
      url.search = normalizedRoute.slice(1, hashIndex);
      url.hash = normalizedRoute.slice(hashIndex);
    } else {
      url.search = normalizedRoute.slice(1);
    }
  } else if (normalizedRoute === "/") {
    url.search = "";
    url.hash = "";
  } else if (normalizedRoute.startsWith("/editor")) {
    url.hash = `#${normalizedRoute}`;
  } else if (normalizedRoute.startsWith("/#")) {
    url.hash = normalizedRoute.slice(1);
  } else {
    url.hash = `#${normalizedRoute.startsWith("/") ? normalizedRoute : `/${normalizedRoute}`}`;
  }

  url.searchParams.set(BROWSER_WINDOW_ID_QUERY_KEY, windowId);
  return url.toString();
};

const buildWindowOpenFeatures = (options?: {
  inheritCurrentWindowState?: boolean;
}) => {
  if (typeof window === "undefined") {
    return undefined;
  }

  const features = ["popup=yes"];

  if (options?.inheritCurrentWindowState) {
    features.push(
      `width=${Math.max(640, Math.round(window.outerWidth || 1280))}`,
    );
    features.push(
      `height=${Math.max(480, Math.round(window.outerHeight || 800))}`,
    );

    if (Number.isFinite(window.screenX)) {
      features.push(`left=${Math.round(window.screenX)}`);
    }

    if (Number.isFinite(window.screenY)) {
      features.push(`top=${Math.round(window.screenY)}`);
    }
  }

  return features.join(",");
};

const stripWindowIdQueryParam = () => {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  if (!url.searchParams.has(BROWSER_WINDOW_ID_QUERY_KEY)) {
    return;
  }

  url.searchParams.delete(BROWSER_WINDOW_ID_QUERY_KEY);
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
};

const readInitialBrowserWindowId = () => {
  if (typeof window === "undefined") {
    return createBrowserWindowId();
  }

  const url = new URL(window.location.href);
  const fromUrl = normalizeBrowserPlatformWindowId(
    url.searchParams.get(BROWSER_WINDOW_ID_QUERY_KEY),
  );
  const fromName = normalizeBrowserPlatformWindowId(window.name);
  const fromStorage = normalizeBrowserPlatformWindowId(
    window.sessionStorage.getItem(BROWSER_WINDOW_ID_STORAGE_KEY),
  );

  return fromUrl ?? fromName ?? fromStorage ?? createBrowserWindowId();
};

const getCurrentWindowStateSnapshot =
  (): BrowserPlatformWindowRecord | null => {
    const windowId = getBrowserPlatformWindowId();
    const snapshot =
      currentWindowState ??
      normalizeBrowserPlatformWindowRecord({
        windowId,
        title: typeof document !== "undefined" ? document.title || null : null,
        sourceKeys: [],
        updatedAt: Date.now(),
      });

    if (!snapshot) {
      return null;
    }

    return {
      ...snapshot,
      updatedAt: Date.now(),
    };
  };

const postMessageToActiveServiceWorker = async (
  message: ServiceWorkerRequestMessage,
  transfer?: Transferable[],
) => {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }

  const registration = await navigator.serviceWorker.ready.catch(() => null);
  const target =
    navigator.serviceWorker.controller ??
    registration?.active ??
    registration?.waiting ??
    registration?.installing ??
    null;

  if (!target) {
    return false;
  }

  target.postMessage(message, transfer ?? []);
  return true;
};

const requestServiceWorkerReply = async (
  message: ServiceWorkerReplyRequestMessage,
) => {
  if (typeof window === "undefined" || typeof MessageChannel === "undefined") {
    return null;
  }

  const channel = new MessageChannel();
  const responsePromise =
    new Promise<ServiceWorkerRegistryResponseMessage | null>((resolve) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        channel.port1.close();
        resolve(null);
      }, SERVICE_WORKER_RESPONSE_TIMEOUT_MS);

      channel.port1.onmessage = (event) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        channel.port1.close();

        const payload =
          event.data as Partial<ServiceWorkerRegistryResponseMessage>;
        if (
          payload?.requestId !== message.requestId ||
          typeof payload.ok !== "boolean"
        ) {
          resolve(null);
          return;
        }

        resolve({
          requestId: message.requestId,
          ok: payload.ok,
          records: Array.isArray(payload.records)
            ? payload.records
                .map((record) => normalizeBrowserPlatformWindowRecord(record))
                .filter(
                  (record): record is BrowserPlatformWindowRecord =>
                    record !== null,
                )
            : undefined,
        });
      };
    });

  const sent = await postMessageToActiveServiceWorker(message, [channel.port2]);
  if (!sent) {
    channel.port1.close();
    channel.port2.close();
    return null;
  }

  return await responsePromise;
};

const listWindowRegistryFromServiceWorker = async () => {
  const requestId = createServiceWorkerRequestId("list");
  const response = await requestServiceWorkerReply({
    type: SERVICE_WORKER_REGISTRY_LIST_REQUEST,
    requestId,
  });

  if (!response?.ok || !Array.isArray(response.records)) {
    return [];
  }

  return sortBrowserPlatformWindows(response.records);
};

const persistWindowStateToServiceWorker = async (
  record: BrowserPlatformWindowRecord,
  options?: { awaitReply?: boolean },
) => {
  const normalizedRecord = normalizeBrowserPlatformWindowRecord(record);
  if (!normalizedRecord) {
    return false;
  }

  const requestId = options?.awaitReply
    ? createServiceWorkerRequestId("upsert")
    : undefined;
  if (!requestId) {
    return await postMessageToActiveServiceWorker({
      type: SERVICE_WORKER_REGISTRY_UPSERT_REQUEST,
      record: normalizedRecord,
    });
  }

  const response = await requestServiceWorkerReply({
    type: SERVICE_WORKER_REGISTRY_UPSERT_REQUEST,
    requestId,
    record: normalizedRecord,
  });
  return response?.ok === true;
};

const removeWindowStateFromServiceWorker = async (
  windowId: EditorWindowId,
  options?: { awaitReply?: boolean },
) => {
  const normalizedWindowId = normalizeBrowserPlatformWindowId(windowId);
  if (!normalizedWindowId) {
    return false;
  }

  const requestId = options?.awaitReply
    ? createServiceWorkerRequestId("remove")
    : undefined;
  if (!requestId) {
    return await postMessageToActiveServiceWorker({
      type: SERVICE_WORKER_REGISTRY_REMOVE_REQUEST,
      windowId: normalizedWindowId,
    });
  }

  const response = await requestServiceWorkerReply({
    type: SERVICE_WORKER_REGISTRY_REMOVE_REQUEST,
    requestId,
    windowId: normalizedWindowId,
  });
  return response?.ok === true;
};

const refreshWindowRegistryListeners = async () => {
  const activeRecords = await listWindowRegistryFromServiceWorker();
  const nextSignature =
    getBrowserPlatformWindowRegistrySignature(activeRecords);

  if (nextSignature === lastRegistrySignature) {
    return;
  }

  lastRegistrySignature = nextSignature;
  notifyBrowserWindowRegistryListeners();
};

const scheduleWindowRegistryRefresh = () => {
  if (registryRefreshPromise) {
    return registryRefreshPromise;
  }

  registryRefreshPromise = (async () => {
    try {
      await refreshWindowRegistryListeners();
    } finally {
      registryRefreshPromise = null;
    }
  })();

  return registryRefreshPromise;
};

const writeCurrentWindowRegistryState = (options?: {
  notify?: boolean;
  awaitReply?: boolean;
}) => {
  const snapshot = getCurrentWindowStateSnapshot();
  if (!snapshot) {
    return;
  }

  currentWindowState = snapshot;

  void enqueueRegistryMutation(async () => {
    const ok = await persistWindowStateToServiceWorker(snapshot, {
      awaitReply: options?.awaitReply,
    });

    if (!ok) {
      throw new Error("Failed to persist browser platform window state");
    }

    if (options?.notify) {
      await scheduleWindowRegistryRefresh();
    }
  }).catch((error) => {
    console.error("Failed to persist browser platform window state", error);
  });
};

const unregisterCurrentWindowRegistryState = async (options?: {
  awaitReply?: boolean;
}) => {
  const snapshot = currentWindowState;
  if (!snapshot) {
    return true;
  }

  currentWindowState = null;

  try {
    return await enqueueRegistryMutation(async () => {
      const removed = await removeWindowStateFromServiceWorker(
        snapshot.windowId,
        {
          awaitReply: options?.awaitReply,
        },
      );

      if (!removed) {
        throw new Error("Failed to remove browser platform window state");
      }

      await scheduleWindowRegistryRefresh();
      return true;
    });
  } catch (error) {
    console.error("Failed to remove browser platform window state", error);
    return false;
  }
};

const bindServiceWorkerBridge = () => {
  if (
    serviceWorkerBridgeBound ||
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator)
  ) {
    return;
  }

  serviceWorkerBridgeBound = true;

  navigator.serviceWorker.addEventListener("message", (event) => {
    const payload = event.data as
      | Partial<ServiceWorkerDiscoveryProbeMessage>
      | Partial<ServiceWorkerRegistryChangedMessage>
      | undefined;

    if (payload?.type === SERVICE_WORKER_DISCOVERY_PROBE) {
      const requestId =
        typeof payload.requestId === "string" ? payload.requestId.trim() : "";
      if (!requestId) {
        return;
      }

      const snapshot = getCurrentWindowStateSnapshot();
      if (!snapshot) {
        return;
      }

      void postMessageToActiveServiceWorker({
        type: SERVICE_WORKER_DISCOVERY_REPORT,
        requestId,
        record: snapshot,
      } satisfies ServiceWorkerDiscoveryReportMessage);
      return;
    }

    if (payload?.type === SERVICE_WORKER_REGISTRY_CHANGED) {
      void scheduleWindowRegistryRefresh();
    }
  });
};

const stopBrowserWindowLifecycle = () => {
  browserWindowLifecycleCleanup?.();
};

const ensureBrowserWindowLifecycle = () => {
  if (browserWindowLifecycleStarted || !supportsPlatformMultiWindow()) {
    return;
  }

  browserWindowLifecycleStarted = true;
  bindServiceWorkerBridge();

  currentWindowState = {
    windowId: getBrowserPlatformWindowId(),
    title: typeof document !== "undefined" ? document.title || null : null,
    sourceKeys: [],
    updatedAt: Date.now(),
  };

  writeCurrentWindowRegistryState({ notify: true });
  ensureBroadcastChannel();

  if (typeof window !== "undefined") {
    browserWindowHeartbeatId = window.setInterval(() => {
      writeCurrentWindowRegistryState();
    }, WINDOW_HEARTBEAT_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        writeCurrentWindowRegistryState();
      }
    };

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;
      if (browserWindowHeartbeatId !== null) {
        window.clearInterval(browserWindowHeartbeatId);
        browserWindowHeartbeatId = null;
      }

      window.removeEventListener("beforeunload", cleanup);
      window.removeEventListener("pagehide", cleanup);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void unregisterCurrentWindowRegistryState();
      browserWindowLifecycleStarted = false;
      browserWindowLifecycleCleanup = null;
    };

    browserWindowLifecycleCleanup = cleanup;
    window.addEventListener("beforeunload", cleanup);
    window.addEventListener("pagehide", cleanup);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }
};

const ensureBrowserRuntimeSync = () => {
  if (browserRuntimeSyncStarted || typeof window === "undefined") {
    return;
  }

  browserRuntimeSyncStarted = true;

  const handleRuntimeChange = () => {
    if (supportsPlatformMultiWindow()) {
      ensureBrowserWindowLifecycle();
      void scheduleWindowRegistryRefresh();
      return;
    }

    stopBrowserWindowLifecycle();
  };

  subscribePlatformRuntimeChange(handleRuntimeChange);
  handleRuntimeChange();
};

const ensureBroadcastChannel = () => {
  if (!supportsPlatformMultiWindow() || typeof window === "undefined") {
    return null;
  }

  if (!cachedBroadcastChannel) {
    cachedBroadcastChannel = new BroadcastChannel(
      BROWSER_PLATFORM_CHANNEL_NAME,
    );
  }

  if (!broadcastChannelBound) {
    cachedBroadcastChannel.addEventListener("message", (event) => {
      const payload = event.data as Partial<
        BrowserPlatformBroadcastEnvelope<unknown>
      >;

      if (payload?.kind !== "channel-message") {
        return;
      }

      const message = payload.message as Partial<
        BrowserPlatformMessageEnvelope<unknown>
      >;
      const channelName =
        typeof message?.channel === "string" ? message.channel : null;
      const sourceWindowId = normalizeBrowserPlatformWindowId(
        message?.sourceWindowId,
      );
      const targetWindowId = message?.targetWindowId
        ? normalizeBrowserPlatformWindowId(message.targetWindowId)
        : null;

      if (!channelName || !sourceWindowId) {
        return;
      }

      const currentWindowId = getBrowserPlatformWindowId();
      if (sourceWindowId === currentWindowId) {
        return;
      }

      if (targetWindowId && targetWindowId !== currentWindowId) {
        return;
      }

      if (channelName === INTERNAL_WINDOW_FOCUS_CHANNEL) {
        try {
          window.focus();
        } catch {
          // ignore
        }
      }

      const listeners = browserMessageListeners.get(channelName);
      if (!listeners || listeners.size === 0) {
        return;
      }

      const normalizedEnvelope: BrowserPlatformMessageEnvelope<unknown> = {
        channel: channelName,
        sourceWindowId,
        ...(targetWindowId ? { targetWindowId } : {}),
        payload: message.payload,
      };

      for (const listener of listeners) {
        listener(normalizedEnvelope);
      }
    });

    broadcastChannelBound = true;
  }

  return cachedBroadcastChannel;
};

export const getBrowserPlatformWindowId = (): EditorWindowId => {
  ensureBrowserRuntimeSync();

  if (cachedBrowserWindowId) {
    return cachedBrowserWindowId;
  }

  cachedBrowserWindowId = readInitialBrowserWindowId();

  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(
      BROWSER_WINDOW_ID_STORAGE_KEY,
      cachedBrowserWindowId,
    );
    window.name = cachedBrowserWindowId;
    stripWindowIdQueryParam();
  }

  if (supportsPlatformMultiWindow()) {
    ensureBrowserWindowLifecycle();
  }

  return cachedBrowserWindowId;
};

export const updateBrowserPlatformWindowState = (patch: {
  title?: string | null;
  sourceKeys?: string[];
}) => {
  if (!supportsPlatformMultiWindow()) {
    return;
  }

  ensureBrowserWindowLifecycle();

  const previousState = currentWindowState ?? getCurrentWindowStateSnapshot();
  if (!previousState) {
    return;
  }

  const nextState: BrowserPlatformWindowRecord = {
    ...previousState,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.sourceKeys !== undefined
      ? { sourceKeys: normalizeBrowserPlatformSourceKeys(patch.sourceKeys) }
      : {}),
    updatedAt: Date.now(),
  };

  const previousSignature = getBrowserPlatformWindowRegistrySignature([
    previousState,
  ]);
  const nextSignature = getBrowserPlatformWindowRegistrySignature([nextState]);

  currentWindowState = nextState;
  writeCurrentWindowRegistryState({
    notify: previousSignature !== nextSignature,
  });
};

export const unregisterCurrentBrowserPlatformWindow = async (options?: {
  awaitReply?: boolean;
}) => {
  if (!supportsPlatformMultiWindow()) {
    return true;
  }

  return await unregisterCurrentWindowRegistryState({
    awaitReply: options?.awaitReply,
  });
};

export const listBrowserPlatformWindows = async (): Promise<
  BrowserPlatformWindowRecord[]
> => {
  if (!supportsPlatformMultiWindow()) {
    return [];
  }

  ensureBrowserWindowLifecycle();
  return await listWindowRegistryFromServiceWorker();
};

const emitBroadcastEnvelope = async <T>(
  envelope: BrowserPlatformBroadcastEnvelope<T>,
) => {
  const broadcastChannel = ensureBroadcastChannel();
  if (!broadcastChannel) {
    return false;
  }

  broadcastChannel.postMessage(envelope);
  return true;
};

export const emitBrowserPlatformMessage = async <T>(
  channelName: string,
  payload: T,
  targetWindowId?: EditorWindowId,
) => {
  const sourceWindowId = getBrowserPlatformWindowId();

  return await emitBroadcastEnvelope({
    kind: "channel-message",
    message: {
      channel: channelName,
      sourceWindowId,
      ...(targetWindowId ? { targetWindowId } : {}),
      payload,
    },
  });
};

export const listenForBrowserPlatformMessage = async <T>(
  channelName: string,
  listener: (payload: T) => void,
) => {
  if (!supportsPlatformMultiWindow()) {
    return () => {};
  }

  ensureBrowserWindowLifecycle();
  ensureBroadcastChannel();

  const listeners = browserMessageListeners.get(channelName) ?? new Set();
  const wrappedListener: BrowserPlatformMessageListener = (envelope) => {
    listener(envelope.payload as T);
  };

  listeners.add(wrappedListener);
  browserMessageListeners.set(channelName, listeners);

  return () => {
    const currentListeners = browserMessageListeners.get(channelName);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(wrappedListener);
    if (currentListeners.size === 0) {
      browserMessageListeners.delete(channelName);
    }
  };
};

export const subscribeBrowserPlatformWindowRegistryChange = async (
  listener: () => void,
) => {
  ensureBrowserRuntimeSync();
  browserWindowRegistryListeners.add(listener);

  return () => {
    browserWindowRegistryListeners.delete(listener);
  };
};

export const focusBrowserPlatformWindow = async (windowId: EditorWindowId) => {
  if (!supportsPlatformMultiWindow()) {
    return false;
  }

  const availableWindows = await listWindowRegistryFromServiceWorker();
  if (
    !availableWindows.some((windowInfo) => windowInfo.windowId === windowId)
  ) {
    return false;
  }

  if (windowId === getBrowserPlatformWindowId()) {
    try {
      window.focus();
    } catch {
      // ignore
    }
    return true;
  }

  await emitBrowserPlatformMessage(
    INTERNAL_WINDOW_FOCUS_CHANNEL,
    { windowId },
    windowId,
  );
  return true;
};

export const openBrowserPlatformWindow = async (
  options: OpenBrowserPlatformWindowOptions,
) => {
  if (!supportsPlatformMultiWindow() || typeof window === "undefined") {
    return {
      ok: false as const,
      created: false as const,
      reason: "unsupported" as const,
    };
  }

  ensureBrowserWindowLifecycle();

  const existingWindow = (await listWindowRegistryFromServiceWorker()).find(
    (windowInfo) => windowInfo.windowId === options.windowId,
  );

  if (existingWindow) {
    if (options.focus !== false) {
      await focusBrowserPlatformWindow(options.windowId);
    }

    return {
      ok: true as const,
      created: false as const,
    };
  }

  const nextWindow = window.open(
    buildBrowserWindowUrl(options.route, options.windowId),
    options.windowId,
    buildWindowOpenFeatures(options),
  );

  if (!nextWindow) {
    return {
      ok: false as const,
      created: false as const,
      reason: "create_failed" as const,
    };
  }

  if (options.focus !== false) {
    try {
      nextWindow.focus();
    } catch {
      // ignore
    }
  }

  return {
    ok: true as const,
    created: true as const,
  };
};

export const isInstalledPwaWindow = () => isInstalledPwa();
