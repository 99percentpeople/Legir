/// <reference lib="webworker" />

import {
  deleteStoredBrowserPlatformWindowRecords,
  getBrowserPlatformWindowRegistrySignature,
  listStoredBrowserPlatformWindowRecords,
  normalizeBrowserPlatformWindowId,
  normalizeBrowserPlatformWindowRecord,
  putStoredBrowserPlatformWindowRecord,
  upsertStoredBrowserPlatformWindowRecords,
} from "./store";
import {
  SERVICE_WORKER_DISCOVERY_PROBE,
  SERVICE_WORKER_DISCOVERY_REPORT,
  SERVICE_WORKER_REGISTRY_CHANGED,
  SERVICE_WORKER_REGISTRY_LIST_REQUEST,
  SERVICE_WORKER_REGISTRY_REMOVE_REQUEST,
  SERVICE_WORKER_REGISTRY_UPSERT_REQUEST,
  WINDOW_STALE_TTL_MS,
  type BrowserPlatformWindowRecord,
  type ServiceWorkerDiscoveryProbeMessage,
  type ServiceWorkerDiscoveryReportMessage,
  type ServiceWorkerRegistryChangedMessage,
  type ServiceWorkerRegistryListRequestMessage,
  type ServiceWorkerRegistryRemoveRequestMessage,
  type ServiceWorkerRegistryResponseMessage,
  type ServiceWorkerRegistryUpsertRequestMessage,
} from "./protocol";

type BrowserMultiWindowServiceWorker = ServiceWorkerGlobalScope;

type PendingDiscoveryRequest = {
  resolve: (records: BrowserPlatformWindowRecord[]) => void;
  records: Map<string, BrowserPlatformWindowRecord>;
  timeoutId: ReturnType<typeof globalThis.setTimeout>;
};

type BrowserPlatformServiceWorkerMessage = Partial<
  | ServiceWorkerDiscoveryReportMessage
  | ServiceWorkerRegistryListRequestMessage
  | ServiceWorkerRegistryUpsertRequestMessage
  | ServiceWorkerRegistryRemoveRequestMessage
>;

let browserMultiWindowServiceWorkerRegistered = false;

const createDiscoveryRequestId = () =>
  `sw_discover_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const sortWindowRecords = (records: BrowserPlatformWindowRecord[]) => {
  return [...records].sort((left, right) =>
    left.windowId.localeCompare(right.windowId),
  );
};

const resolveDiscoveryRequestId = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const replyToPort = (
  port: MessagePort | undefined,
  payload: ServiceWorkerRegistryResponseMessage,
) => {
  if (!port) {
    return;
  }

  port.postMessage(payload);
  port.close();
};

export const registerBrowserMultiWindowServiceWorker = (
  serviceWorker: BrowserMultiWindowServiceWorker,
) => {
  if (browserMultiWindowServiceWorkerRegistered) {
    return;
  }

  browserMultiWindowServiceWorkerRegistered = true;

  const pendingDiscoveryRequests = new Map<string, PendingDiscoveryRequest>();

  const broadcastRegistryChanged = async (sourceWindowId?: string) => {
    const windowClients = await serviceWorker.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });

    const payload: ServiceWorkerRegistryChangedMessage = {
      type: SERVICE_WORKER_REGISTRY_CHANGED,
      ...(sourceWindowId ? { sourceWindowId } : {}),
    };

    for (const client of windowClients) {
      client.postMessage(payload);
    }
  };

  const settleDiscoveryRequest = (requestId: string) => {
    const pending = pendingDiscoveryRequests.get(requestId);
    if (!pending) {
      return;
    }

    globalThis.clearTimeout(pending.timeoutId);
    pendingDiscoveryRequests.delete(requestId);
    pending.resolve(sortWindowRecords([...pending.records.values()]));
  };

  const discoverWindowRecords = async (): Promise<
    BrowserPlatformWindowRecord[]
  > => {
    const requestId = createDiscoveryRequestId();

    const discoveryPromise = new Promise<BrowserPlatformWindowRecord[]>(
      (resolve) => {
        const timeoutId = globalThis.setTimeout(() => {
          settleDiscoveryRequest(requestId);
        }, 350);

        pendingDiscoveryRequests.set(requestId, {
          resolve,
          records: new Map(),
          timeoutId,
        });
      },
    );

    const windowClients = await serviceWorker.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });

    if (windowClients.length === 0) {
      settleDiscoveryRequest(requestId);
      return await discoveryPromise;
    }

    for (const client of windowClients) {
      client.postMessage({
        type: SERVICE_WORKER_DISCOVERY_PROBE,
        requestId,
      } satisfies ServiceWorkerDiscoveryProbeMessage);
    }

    return await discoveryPromise;
  };

  const pruneStaleWindowRecords = async () => {
    const allRecords = await listStoredBrowserPlatformWindowRecords();
    const now = Date.now();
    const activeRecords: BrowserPlatformWindowRecord[] = [];
    const staleWindowIds: string[] = [];

    for (const record of allRecords) {
      if (now - record.updatedAt > WINDOW_STALE_TTL_MS) {
        staleWindowIds.push(record.windowId);
        continue;
      }

      activeRecords.push(record);
    }

    if (staleWindowIds.length > 0) {
      await deleteStoredBrowserPlatformWindowRecords(staleWindowIds);
    }

    return {
      activeRecords: sortWindowRecords(activeRecords),
      removedAny: staleWindowIds.length > 0,
    };
  };

  const listRegistryRecords = async () => {
    const { activeRecords, removedAny } = await pruneStaleWindowRecords();
    if (activeRecords.length > 0) {
      if (removedAny) {
        await broadcastRegistryChanged();
      }
      return activeRecords;
    }

    const discovered = await discoverWindowRecords();
    if (discovered.length > 0) {
      await upsertStoredBrowserPlatformWindowRecords(discovered);
      await broadcastRegistryChanged();
      return sortWindowRecords(discovered);
    }

    if (removedAny) {
      await broadcastRegistryChanged();
    }

    return [];
  };

  serviceWorker.addEventListener("message", (event) => {
    const payload = event.data as
      | BrowserPlatformServiceWorkerMessage
      | undefined;

    if (payload?.type === SERVICE_WORKER_DISCOVERY_REPORT) {
      const requestId = resolveDiscoveryRequestId(payload.requestId);
      if (!requestId) {
        return;
      }

      const pending = pendingDiscoveryRequests.get(requestId);
      if (!pending) {
        return;
      }

      const record = normalizeBrowserPlatformWindowRecord(payload.record);
      if (!record) {
        return;
      }

      pending.records.set(record.windowId, record);
      return;
    }

    if (payload?.type === SERVICE_WORKER_REGISTRY_LIST_REQUEST) {
      const requestId = resolveDiscoveryRequestId(payload.requestId);
      const port = event.ports?.[0];

      if (!requestId || !port) {
        return;
      }

      event.waitUntil(
        (async () => {
          try {
            const records = await listRegistryRecords();
            replyToPort(port, {
              requestId,
              ok: true,
              records,
            });
          } catch (error) {
            console.error("Failed to list browser platform windows", error);
            replyToPort(port, {
              requestId,
              ok: false,
            });
          }
        })(),
      );
      return;
    }

    if (payload?.type === SERVICE_WORKER_REGISTRY_UPSERT_REQUEST) {
      const record = normalizeBrowserPlatformWindowRecord(payload.record);
      const requestId = resolveDiscoveryRequestId(payload.requestId);
      const port = event.ports?.[0];

      if (!record) {
        replyToPort(
          port,
          requestId
            ? {
                requestId,
                ok: false,
              }
            : {
                requestId: "",
                ok: false,
              },
        );
        return;
      }

      event.waitUntil(
        (async () => {
          try {
            const previousRecord = (
              await listStoredBrowserPlatformWindowRecords()
            ).find((item) => item.windowId === record.windowId);
            const previousSignature = previousRecord
              ? getBrowserPlatformWindowRegistrySignature([previousRecord])
              : "";
            const nextSignature = getBrowserPlatformWindowRegistrySignature([
              record,
            ]);

            await putStoredBrowserPlatformWindowRecord(record);

            if (previousSignature !== nextSignature) {
              await broadcastRegistryChanged(record.windowId);
            }

            if (requestId) {
              replyToPort(port, {
                requestId,
                ok: true,
              });
            }
          } catch (error) {
            console.error("Failed to persist browser platform window", error);
            if (requestId) {
              replyToPort(port, {
                requestId,
                ok: false,
              });
            }
          }
        })(),
      );
      return;
    }

    if (payload?.type === SERVICE_WORKER_REGISTRY_REMOVE_REQUEST) {
      const windowId = normalizeBrowserPlatformWindowId(payload.windowId);
      const requestId = resolveDiscoveryRequestId(payload.requestId);
      const port = event.ports?.[0];

      if (!windowId) {
        replyToPort(
          port,
          requestId
            ? {
                requestId,
                ok: false,
              }
            : {
                requestId: "",
                ok: false,
              },
        );
        return;
      }

      event.waitUntil(
        (async () => {
          try {
            const existed = (
              await listStoredBrowserPlatformWindowRecords()
            ).some((record) => record.windowId === windowId);

            await deleteStoredBrowserPlatformWindowRecords([windowId]);

            if (existed) {
              await broadcastRegistryChanged(windowId);
            }

            if (requestId) {
              replyToPort(port, {
                requestId,
                ok: true,
              });
            }
          } catch (error) {
            console.error("Failed to remove browser platform window", error);
            if (requestId) {
              replyToPort(port, {
                requestId,
                ok: false,
              });
            }
          }
        })(),
      );
    }
  });
};
