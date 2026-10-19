import PDFRenderWorker from "@/workers/pdf-render.worker?worker";
import type { DocumentCommands, ExportPdfRequest } from "./engine/sessionTypes";
import type { FontHostRequest } from "./engine/fontHost";
import { getPlatformSystemFontBytes } from "@/services/platform/fonts";
import type { PageData, PageSource, HistorySnapshot } from "@/types";
import type { ThumbnailContent, Tile } from "./types";
import type { TextContent } from "@/services/pdfService/engine/textTypes";
import type { PDFDocumentPermissions, PDFOutlineItem } from "@/types";
import type {
  WorkerCommandType,
  WorkerErrorResponse,
  WorkerMessage,
  WorkerRequest,
  WorkerSuccessResponse,
} from "./workerProtocol";

type WorkerHost = {
  worker: Worker | null;
  initWorker: () => void;
};

const RequireWorkerPromise = (throwError = true) => {
  return <Args extends unknown[], Result>(
    _target: unknown,
    _propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<(...args: Args) => Promise<Result>>,
  ) => {
    const original = descriptor.value;
    if (!original) return;

    const wrapped = function (this: WorkerHost, ...args: Args) {
      if (!this.worker) {
        this.initWorker();
        if (!this.worker) {
          if (throwError) {
            return Promise.reject(
              new Error("Worker not initialized"),
            ) as Promise<Result>;
          } else {
            return Promise.resolve(undefined as Result);
          }
        }
      }
      return original.apply(this, args);
    };

    descriptor.value = wrapped;
  };
};

const RequireWorkerVoid = () => {
  return <Args extends unknown[]>(
    _target: unknown,
    _propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<(...args: Args) => void>,
  ) => {
    const original = descriptor.value;
    if (!original) return;

    const wrapped = function (this: WorkerHost, ...args: Args) {
      if (!this.worker) {
        this.initWorker();
        if (!this.worker) {
          return;
        }
      }
      return original.apply(this, args);
    };

    descriptor.value = wrapped;
  };
};

type PendingRequestHandlers<TType extends WorkerCommandType> = {
  resolve: (msg: WorkerSuccessResponse<TType>) => void;
  reject: (msg: WorkerErrorResponse) => void;
  onProgress?: (payload: { loaded: number; total?: number }) => void;
};

import { documentOwners as byteOwners } from "./engine/documentOwners";
export { getPdfWorkerForBytes } from "./engine/documentOwners";

class PDFWorkerService {
  readonly supportsImportPreview = true;
  private ownedBytes = new Set<Uint8Array>();
  private loadedSourceIds = new Set<string>();
  private worker: Worker | null = null;
  private pendingRequests = new Map<
    string,
    PendingRequestHandlers<WorkerCommandType>
  >();
  private requestSeq = 0;
  private logicalPages: PageData[] = [];
  private pageSources: Record<string, PageSource> = {};
  private sourceLoads = new Map<string, Promise<boolean>>();
  private lifetime = new AbortController();
  private sourceResources = new Map<string, () => void>();
  public retainSourceResources(id: string, dispose: () => void) {
    this.sourceResources.get(id)?.();
    this.sourceResources.set(id, dispose);
  }

  private retainedSourceIds = new Set<string>();
  public configurePages(
    pages: PageData[],
    sources: Record<string, PageSource>,
    history: HistorySnapshot[] = [],
  ) {
    if (this.lifetime.signal.aborted) return;
    this.logicalPages = pages;
    this.pageSources = sources;
    this.retainedSourceIds = new Set([
      ...Object.keys(sources),
      ...history.flatMap((item) => Object.keys(item.pageSources ?? {})),
      ...[...pages, ...history.flatMap((item) => item.pages ?? [])]
        .filter((page) => page.blank)
        .map((page) => `blank:${page.width}:${page.height}`),
    ]);
    for (const id of new Set([
      ...this.sourceLoads.keys(),
      ...this.sourceResources.keys(),
      ...this.loadedSourceIds,
    ])) {
      if (this.retainedSourceIds.has(id)) continue;
      this.unloadDocument(id);
      this.sourceLoads.delete(id);
      this.sourceResources.get(id)?.();
      this.sourceResources.delete(id);
    }
  }

  private routePage<T extends { pageIndex: number; docId?: string }>(
    options: T,
  ): T {
    if (options.docId !== undefined) return options;
    const page = this.logicalPages[options.pageIndex];
    if (!page) return options;
    if (page.blank)
      return {
        ...options,
        docId: `blank:${page.width}:${page.height}`,
        pageIndex: 0,
      };
    return page.source
      ? {
          ...options,
          docId: page.source.documentId,
          pageIndex: page.source.pageIndex,
        }
      : options;
  }

  private async preparePage<
    T extends { pageIndex: number; docId?: string; signal?: AbortSignal },
  >(options: T): Promise<T> {
    const routed = this.routePage(options);
    const docId = routed.docId;
    if (!docId || docId === this.defaultDocId || options.docId !== undefined)
      return routed;
    if (this.loadedSourceIds.has(docId)) return routed;
    let pending = this.sourceLoads.get(docId);
    if (!pending) {
      const source = this.pageSources[docId];
      pending = (async () => {
        const bytes = source?.bytes;
        if (docId.startsWith("blank:")) {
          const [, width, height] = docId.split(":").map(Number);
          return await this.documentCommand(
            "addBlankSource",
            { docId, width, height },
            this.lifetime.signal,
          );
        }
        if (!bytes) throw new Error("PDF page source is unavailable");
        this.lifetime.signal.throwIfAborted();
        const loaded = await this.loadDocument(bytes, {
          docId,
          password: source?.password ?? undefined,
          pageIndexes: source?.pageIndexes,
          signal: this.lifetime.signal,
        });
        if (!this.retainedSourceIds.has(docId)) this.unloadDocument(docId);
        return loaded;
      })();
      this.sourceLoads.set(docId, pending);
      void pending.catch(() => this.sourceLoads.delete(docId));
    }
    await pending;
    options.signal?.throwIfAborted();
    return routed;
  }

  private passwordByDocId = new Map<string, string>();

  private readonly defaultDocId: string = "default";

  private lastRenderScaleByDocPage = new Map<string, number>();
  private textContentCacheByDocPage = new Map<string, TextContent>();
  private outlineCacheByDocId = new Map<string, PDFOutlineItem[]>();
  private permissionsCacheByDocId = new Map<string, PDFDocumentPermissions>();

  private failAllPendingRequests(error: string) {
    for (const [id, handlers] of Array.from(this.pendingRequests.entries())) {
      try {
        handlers.reject({ id, success: false, error });
      } catch {
        // ignore
      }
    }
    this.pendingRequests.clear();
  }

  private clearLastRenderScaleForDoc(docId: string) {
    const prefix = `${docId}|`;
    for (const key of Array.from(this.lastRenderScaleByDocPage.keys())) {
      if (key.startsWith(prefix)) this.lastRenderScaleByDocPage.delete(key);
    }
  }

  private clearTextContentCacheForDoc(docId: string) {
    const prefix = `${docId}|`;
    for (const key of Array.from(this.textContentCacheByDocPage.keys())) {
      if (key.startsWith(prefix)) this.textContentCacheByDocPage.delete(key);
    }
  }

  private clearOutlineCacheForDoc(docId: string) {
    this.outlineCacheByDocId.delete(docId);
  }

  private clearPermissionsCacheForDoc(docId: string) {
    this.permissionsCacheByDocId.delete(docId);
  }

  constructor(options?: { lazy?: boolean }) {
    if (!options?.lazy) this.initWorker();
  }

  @RequireWorkerPromise()
  public async reprioritize(options: {
    pageIndex: number;
    scale: number;
    viewportCenter: [number, number];
    docId?: string;
    signal?: AbortSignal;
  }): Promise<boolean> {
    options = await this.preparePage(options);
    return new Promise((resolve, reject) => {
      const worker = this.worker;
      if (!worker) {
        reject(new Error("Worker not initialized"));
        return;
      }
      const {
        pageIndex,
        scale,
        viewportCenter,
        docId: requestedDocId,
        signal,
      } = options;
      const docId = requestedDocId ?? this.defaultDocId;

      const id = `reprioritize_${docId}_${pageIndex}_${scale}_${this.requestSeq++}_${Date.now()}`;

      if (signal?.aborted) {
        const err = new DOMException("Aborted", "AbortError");
        (err as DOMException & { phase?: string }).phase = "pre-send";
        reject(err);
        return;
      }

      const onAbort = () => {
        const msg: WorkerRequest = { type: "cancel", id };
        this.worker?.postMessage(msg);
        this.pendingRequests.delete(id);
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        this.pendingRequests.set(id, {
          resolve: (msg: WorkerSuccessResponse<"reprioritize">) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            resolve(Boolean(msg.payload ?? true));
          },
          reject: (msg: WorkerErrorResponse) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            reject(new Error(msg.error));
          },
        });

        const message: WorkerRequest = {
          type: "reprioritize",
          id,
          docId,
          pageIndex,
          scale,
          viewportCenter,
        };

        worker.postMessage(message);
      } catch (e) {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    });
  }

  private initWorker() {
    // Canvas/thumbnail cleanup may arrive after the tab's owner is destroyed.
    // Those callbacks must never resurrect a worker (and its WASM arena).
    if (this.lifetime.signal.aborted || typeof Worker === "undefined") return;

    try {
      this.worker = new PDFRenderWorker();
      if (this.worker) {
        this.worker.onmessage = (
          e: MessageEvent<WorkerMessage | FontHostRequest>,
        ) => {
          const msg = e.data;
          if ("type" in msg && msg.type === "fontRequest") {
            const worker = this.worker;
            void getPlatformSystemFontBytes(msg.request)
              .catch(() => undefined)
              .then((bytes) => {
                if (worker !== this.worker) return;
                const copied = bytes?.slice();
                worker?.postMessage(
                  { type: "fontResponse", id: msg.id, bytes: copied },
                  copied ? [copied.buffer] : [],
                );
              });
            return;
          }
          if ("type" in msg && msg.type === "loadProgress") {
            const request = this.pendingRequests.get(msg.id);
            if (request?.onProgress) {
              request.onProgress({
                loaded: msg.loaded,
                total: msg.total,
              });
            }
            return;
          }
          if (!("success" in msg)) return;
          const request = this.pendingRequests.get(msg.id);
          if (request) {
            if (msg.success === true) {
              request.resolve(msg);
            } else {
              request.reject(msg);
            }
            this.pendingRequests.delete(msg.id);
          }
        };

        this.worker.onmessageerror = () => {
          this.failAllPendingRequests("Worker message error");
        };

        this.worker.onerror = (evt) => {
          const msg =
            typeof (evt as unknown as { message?: unknown })?.message ===
            "string"
              ? String((evt as unknown as { message: string }).message)
              : "Worker error";
          this.failAllPendingRequests(msg);
        };
      }
    } catch (e) {
      console.error("Failed to initialize PDF Worker", e);
    }
  }

  public destroy() {
    for (const bytes of this.ownedBytes)
      if (byteOwners.get(bytes) === this) byteOwners.delete(bytes);
    this.ownedBytes.clear();
    this.loadedSourceIds.clear();
    this.lifetime.abort();
    this.logicalPages = [];
    this.pageSources = {};
    this.sourceLoads.clear();
    this.sourceResources.forEach((dispose) => dispose());
    this.sourceResources.clear();
    this.failAllPendingRequests("Worker terminated");
    this.passwordByDocId.clear();
    this.lastRenderScaleByDocPage.clear();
    this.textContentCacheByDocPage.clear();
    this.outlineCacheByDocId.clear();
    this.permissionsCacheByDocId.clear();
    this.requestSeq = 0;

    if (!this.worker) return;

    try {
      this.worker.onmessage = null;
      this.worker.onmessageerror = null;
      this.worker.onerror = null;
      this.worker.terminate();
    } catch {
      // ignore worker shutdown errors
    } finally {
      this.worker = null;
    }
  }

  @RequireWorkerPromise()
  public loadDocument(
    data: Uint8Array,
    options?: {
      docId?: string;
      preview?: boolean;
      pageIndexes?: number[];
      signal?: AbortSignal;
      password?: string;
      onProgress?: (payload: { loaded: number; total?: number }) => void;
    },
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const worker = this.worker;
      if (!worker) {
        reject(new Error("Worker not initialized"));
        return;
      }
      const docId = options?.docId ?? this.defaultDocId;
      this.clearLastRenderScaleForDoc(docId);

      const password =
        typeof options?.password === "string"
          ? options.password
          : this.passwordByDocId.get(docId);
      if (typeof password === "string" && password) {
        this.passwordByDocId.set(docId, password);
      }
      this.clearTextContentCacheForDoc(docId);
      this.clearOutlineCacheForDoc(docId);
      this.clearPermissionsCacheForDoc(docId);

      const id = `load_${docId}_${Date.now()}`;
      const signal = options?.signal;

      if (signal?.aborted) {
        const err = new DOMException("Aborted", "AbortError");
        (err as DOMException & { phase?: string }).phase = "pre-send";
        reject(err);
        return;
      }

      const onAbort = () => {
        const msg: WorkerRequest = { type: "cancel", id };
        this.worker?.postMessage(msg);
        this.pendingRequests.delete(id);
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        this.pendingRequests.set(id, {
          resolve: (msg: WorkerSuccessResponse<"load">) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            if (
              msg.payload !== false &&
              docId !== this.defaultDocId &&
              !options?.preview
            )
              this.loadedSourceIds.add(docId);
            if (docId === this.defaultDocId && msg.payload !== false) {
              this.loadedSourceIds.clear();
              this.sourceLoads.clear();
              for (const previous of this.ownedBytes)
                if (byteOwners.get(previous) === this)
                  byteOwners.delete(previous);
              this.ownedBytes.clear();
              byteOwners.set(data, this);
              this.ownedBytes.add(data);
            }
            resolve(Boolean(msg.payload ?? true));
          },
          reject: (msg: WorkerErrorResponse) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            reject(new Error(msg.error));
          },
          onProgress: options?.onProgress,
        });

        const message: WorkerRequest = {
          type: "load",
          preview: options?.preview,
          pageIndexes: options?.pageIndexes,
          id,
          docId,
          data,
          password,
        };

        worker.postMessage(message);
      } catch (e) {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    });
  }

  public documentCommand<K extends keyof DocumentCommands>(
    type: K,
    input: DocumentCommands[K]["input"],
    signal?: AbortSignal,
  ): Promise<DocumentCommands[K]["output"]> {
    signal?.throwIfAborted();
    if (!this.worker) this.initWorker();
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error("Worker not initialized"));
    const request =
      type === "exportDocument" || type === "exportDocumentBlob"
        ? (input as ExportPdfRequest)
        : undefined;
    const structure = request?.options?.pageStructure;
    const payload = structure
      ? {
          ...request,
          options: {
            ...request!.options,
            pageStructure: {
              ...structure,
              sources: Object.fromEntries(
                Object.entries(structure.sources).map(([id, source]) => [
                  id,
                  this.loadedSourceIds.has(id)
                    ? { ...source, bytes: new Uint8Array() }
                    : source,
                ]),
              ),
            },
          },
        }
      : input;
    return new Promise((resolve, reject) => {
      const id = `${type}_${this.requestSeq++}`;
      const abort = () => {
        this.pendingRequests.delete(id);
        worker.postMessage({ type: "cancel", id });
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.pendingRequests.set(id, {
        resolve: (message) => {
          signal?.removeEventListener("abort", abort);
          if (type === "commitImport")
            this.loadedSourceIds.add(
              (input as DocumentCommands["commitImport"]["input"]).docId,
            );
          if (structure)
            for (const id of Object.keys(structure.sources))
              this.loadedSourceIds.add(id);
          resolve(message.payload as DocumentCommands[K]["output"]);
        },
        reject: (message) => {
          signal?.removeEventListener("abort", abort);
          reject(new Error(message.error));
        },
      });
      try {
        worker.postMessage({ ...payload, type, id });
      } catch (error) {
        this.pendingRequests.delete(id);
        signal?.removeEventListener("abort", abort);
        reject(error);
      }
    });
  }

  @RequireWorkerVoid()
  public unloadDocument(docId: string) {
    this.loadedSourceIds.delete(docId);
    if (docId === this.defaultDocId) {
      for (const bytes of this.ownedBytes)
        if (byteOwners.get(bytes) === this) byteOwners.delete(bytes);
      this.ownedBytes.clear();
    }
    this.clearLastRenderScaleForDoc(docId);
    this.passwordByDocId.delete(docId);
    this.clearTextContentCacheForDoc(docId);
    this.clearOutlineCacheForDoc(docId);
    this.clearPermissionsCacheForDoc(docId);
    const id = `unload_${docId}_${Date.now()}`;
    const message: WorkerRequest = { type: "unload", id, docId };
    this.worker?.postMessage(message);
  }

  @RequireWorkerPromise()
  public async getTextContent(options: {
    pageIndex: number;
    docId?: string;
    signal?: AbortSignal;
  }): Promise<TextContent | null> {
    options = await this.preparePage(options);
    return new Promise((resolve, reject) => {
      const worker = this.worker;
      if (!worker) {
        reject(new Error("Worker not initialized"));
        return;
      }
      const { pageIndex, docId: requestedDocId, signal } = options;
      const docId = requestedDocId ?? this.defaultDocId;

      const cacheKey = `${docId}|${pageIndex}`;
      const cached = this.textContentCacheByDocPage.get(cacheKey);
      if (cached) {
        resolve(cached);
        return;
      }

      const id = `getTextContent_${docId}_${pageIndex}_${this.requestSeq++}_${Date.now()}`;

      if (signal?.aborted) {
        const err = new DOMException("Aborted", "AbortError");
        (err as DOMException & { phase?: string }).phase = "pre-send";
        reject(err);
        return;
      }

      const onAbort = () => {
        const msg: WorkerRequest = { type: "cancel", id };
        this.worker?.postMessage(msg);
        this.pendingRequests.delete(id);
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        this.pendingRequests.set(id, {
          resolve: (msg: WorkerSuccessResponse<"getTextContent">) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            const payload = msg.payload;
            if (!payload) {
              resolve(null);
              return;
            }

            this.textContentCacheByDocPage.set(cacheKey, payload);
            resolve(payload);
          },
          reject: (msg: WorkerErrorResponse) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            reject(new Error(msg.error));
          },
        });

        const message: WorkerRequest = {
          type: "getTextContent",
          id,
          docId,
          pageIndex,
        };

        worker.postMessage(message);
      } catch (e) {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    });
  }

  @RequireWorkerPromise()
  public getOutline(options?: {
    docId?: string;
    signal?: AbortSignal;
  }): Promise<PDFOutlineItem[] | null> {
    return new Promise((resolve, reject) => {
      const worker = this.worker;
      if (!worker) {
        reject(new Error("Worker not initialized"));
        return;
      }
      const docId = options?.docId ?? this.defaultDocId;
      const cached = this.outlineCacheByDocId.get(docId);
      if (cached) {
        resolve(cached);
        return;
      }

      const id = `getOutline_${docId}_${this.requestSeq++}_${Date.now()}`;
      const signal = options?.signal;

      if (signal?.aborted) {
        const err = new DOMException("Aborted", "AbortError");
        (err as DOMException & { phase?: string }).phase = "pre-send";
        reject(err);
        return;
      }

      const onAbort = () => {
        const msg: WorkerRequest = { type: "cancel", id };
        this.worker?.postMessage(msg);
        this.pendingRequests.delete(id);
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        this.pendingRequests.set(id, {
          resolve: (msg: WorkerSuccessResponse<"getOutline">) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            const payload = msg.payload;
            if (!Array.isArray(payload)) {
              resolve(null);
              return;
            }
            this.outlineCacheByDocId.set(docId, payload);
            resolve(payload);
          },
          reject: (msg: WorkerErrorResponse) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            reject(new Error(msg.error));
          },
        });

        const message: WorkerRequest = {
          type: "getOutline",
          id,
          docId,
        };

        worker.postMessage(message);
      } catch (e) {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    });
  }

  @RequireWorkerPromise()
  public getPermissions(options?: {
    docId?: string;
    signal?: AbortSignal;
  }): Promise<PDFDocumentPermissions | null> {
    return new Promise((resolve, reject) => {
      const worker = this.worker;
      if (!worker) {
        reject(new Error("Worker not initialized"));
        return;
      }
      const docId = options?.docId ?? this.defaultDocId;
      const cached = this.permissionsCacheByDocId.get(docId);
      if (cached) {
        resolve(cached);
        return;
      }

      const id = `getPermissions_${docId}_${this.requestSeq++}_${Date.now()}`;
      const signal = options?.signal;

      if (signal?.aborted) {
        const err = new DOMException("Aborted", "AbortError");
        (err as DOMException & { phase?: string }).phase = "pre-send";
        reject(err);
        return;
      }

      const onAbort = () => {
        const msg: WorkerRequest = { type: "cancel", id };
        this.worker?.postMessage(msg);
        this.pendingRequests.delete(id);
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        this.pendingRequests.set(id, {
          resolve: (msg: WorkerSuccessResponse<"getPermissions">) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            const payload = msg.payload;
            if (!payload || typeof payload !== "object") {
              resolve(null);
              return;
            }
            const permissions = payload as PDFDocumentPermissions;
            this.permissionsCacheByDocId.set(docId, permissions);
            resolve(permissions);
          },
          reject: (msg: WorkerErrorResponse) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            reject(new Error(msg.error));
          },
        });

        const message: WorkerRequest = {
          type: "getPermissions",
          id,
          docId,
        };

        worker.postMessage(message);
      } catch (e) {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    });
  }

  @RequireWorkerPromise()
  public resolveDest(options: {
    dest: unknown;
    docId?: string;
    signal?: AbortSignal;
  }): Promise<number | null> {
    return new Promise((resolve, reject) => {
      const worker = this.worker;
      if (!worker) {
        reject(new Error("Worker not initialized"));
        return;
      }
      const { dest, docId: requestedDocId, signal } = options;
      const docId = requestedDocId ?? this.defaultDocId;

      const id = `resolveDest_${docId}_${this.requestSeq++}_${Date.now()}`;

      if (signal?.aborted) {
        const err = new DOMException("Aborted", "AbortError");
        (err as DOMException & { phase?: string }).phase = "pre-send";
        reject(err);
        return;
      }

      const onAbort = () => {
        const msg: WorkerRequest = { type: "cancel", id };
        this.worker?.postMessage(msg);
        this.pendingRequests.delete(id);
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        this.pendingRequests.set(id, {
          resolve: (msg: WorkerSuccessResponse<"resolveDest">) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            const payload = msg.payload;
            if (typeof payload !== "number") {
              resolve(null);
              return;
            }
            resolve(payload);
          },
          reject: (msg: WorkerErrorResponse) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            reject(new Error(msg.error));
          },
        });

        const message: WorkerRequest = {
          type: "resolveDest",
          id,
          docId,
          dest,
        };

        worker.postMessage(message);
      } catch (e) {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    });
  }

  @RequireWorkerVoid()
  public cancelQueuedRenders(options: {
    pageIndex: number;
    scale: number;
    docId?: string;
  }) {
    options = this.routePage(options);
    const { pageIndex, scale, docId: requestedDocId } = options;
    const docId = requestedDocId ?? this.defaultDocId;
    const id = `cancelQueuedRenders_${docId}_${pageIndex}_${scale}_${this.requestSeq++}_${Date.now()}`;
    const message: WorkerRequest = {
      type: "cancelQueuedRenders",
      id,
      docId,
      pageIndex,
      scale,
    };
    this.worker?.postMessage(message);
  }

  public releaseCanvas(options: {
    canvasIds: string[];
    signal?: AbortSignal;
  }): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const worker = this.worker;
      if (!worker) {
        // Terminating a worker already releases every owned canvas. Cleanup
        // must be idempotent and must never initialize another worker.
        resolve(true);
        return;
      }
      const { canvasIds, signal } = options;
      const id = `releaseCanvas_${this.requestSeq++}_${Date.now()}`;

      if (signal?.aborted) {
        const err = new DOMException("Aborted", "AbortError");
        (err as DOMException & { phase?: string }).phase = "pre-send";
        reject(err);
        return;
      }

      const onAbort = () => {
        const msg: WorkerRequest = { type: "cancel", id };
        this.worker?.postMessage(msg);
        this.pendingRequests.delete(id);
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        this.pendingRequests.set(id, {
          resolve: (msg: WorkerSuccessResponse<"releaseCanvas">) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            resolve(Boolean(msg.payload ?? true));
          },
          reject: (msg: WorkerErrorResponse) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            if (this.lifetime.signal.aborted) resolve(true);
            else reject(new Error(msg.error));
          },
        });

        const message: WorkerRequest = {
          type: "releaseCanvas",
          id,
          canvasIds,
        };

        worker.postMessage(message);
      } catch (e) {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    });
  }

  @RequireWorkerPromise()
  public async renderPageImage(options: {
    pageIndex: number;
    scale?: number;
    targetWidth?: number;
    rotation?: number;
    clipRect?: { x: number; y: number; width: number; height: number };
    renderAnnotations?: boolean;
    thumbnailContent?: ThumbnailContent;
    mimeType?: string;
    quality?: number;
    priority?: number;
    docId?: string;
    data?: Uint8Array;
    isNewDoc?: boolean;
    password?: string;
    signal?: AbortSignal;
  }): Promise<{ bytes: Uint8Array; mimeType: string }> {
    options = await this.preparePage(options);
    return new Promise((resolve, reject) => {
      const worker = this.worker;
      if (!worker) {
        reject(new Error("Worker not initialized"));
        return;
      }
      const {
        pageIndex,
        scale,
        targetWidth,
        rotation,
        clipRect,
        renderAnnotations,
        thumbnailContent,
        mimeType,
        quality,
        priority,
        docId: requestedDocId,
        data,
        isNewDoc,
        password: requestedPassword,
        signal,
      } = options;

      const docId = requestedDocId ?? this.defaultDocId;

      const password =
        typeof requestedPassword === "string"
          ? requestedPassword
          : this.passwordByDocId.get(docId);
      if (typeof password === "string" && password) {
        this.passwordByDocId.set(docId, password);
      }

      const id = `renderImage_${docId}_${pageIndex}_${this.requestSeq++}_${Date.now()}`;

      if (signal?.aborted) {
        const err = new DOMException("Aborted", "AbortError");
        (err as DOMException & { phase?: string }).phase = "pre-send";
        reject(err);
        return;
      }

      const onAbort = () => {
        const msg: WorkerRequest = { type: "cancel", id };
        this.worker?.postMessage(msg);
        this.pendingRequests.delete(id);
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        this.pendingRequests.set(id, {
          resolve: (msg: WorkerSuccessResponse<"renderImage">) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            const fallbackMime = mimeType || "image/jpeg";
            const payload = msg.payload;
            if (payload === undefined || payload === false) {
              resolve({ bytes: new Uint8Array(), mimeType: fallbackMime });
              return;
            }
            const p = payload as { mimeType?: unknown; imageBytes?: unknown };
            const outMime =
              typeof p.mimeType === "string" && p.mimeType
                ? p.mimeType
                : fallbackMime;
            const bytesBuf =
              p.imageBytes instanceof ArrayBuffer ? p.imageBytes : undefined;

            if (!bytesBuf) {
              resolve({ bytes: new Uint8Array(), mimeType: outMime });
              return;
            }
            resolve({ bytes: new Uint8Array(bytesBuf), mimeType: outMime });
          },
          reject: (msg: WorkerErrorResponse) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            reject(new Error(msg.error));
          },
        });

        if (isNewDoc) {
          if (!data) {
            throw new Error("Missing data for isNewDoc renderImage");
          }
          const message: WorkerRequest = {
            type: "renderImage",
            id,
            docId,
            isNewDoc: true,
            data,
            password,
            pageIndex,
            scale,
            targetWidth,
            rotation,
            clipRect,
            renderAnnotations,
            thumbnailContent,
            mimeType,
            quality,
            priority: priority || 0,
          };
          worker.postMessage(message);
        } else {
          const message: WorkerRequest = {
            type: "renderImage",
            id,
            docId,
            pageIndex,
            scale,
            targetWidth,
            rotation,
            clipRect,
            renderAnnotations,
            thumbnailContent,
            mimeType,
            quality,
            priority: priority || 0,
          };
          worker.postMessage(message);
        }
      } catch (e) {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    });
  }

  @RequireWorkerPromise()
  public async renderPage(options: {
    pageIndex: number;
    scale: number;
    rotation?: number;
    canvas?: OffscreenCanvas;
    canvasId: string;
    priority?: number;
    /** Defaults to full page if not provided */
    tile?: Tile;
    docId?: string;
    signal?: AbortSignal;
  }): Promise<boolean> {
    options = await this.preparePage(options);
    return new Promise((resolve, reject) => {
      const worker = this.worker;
      if (!worker) {
        reject(new Error("Worker not initialized"));
        return;
      }
      const {
        pageIndex,
        scale,
        rotation,
        canvas,
        canvasId,
        priority,
        tile,
        docId: requestedDocId,
        signal,
      } = options;

      const docId = requestedDocId ?? this.defaultDocId;
      const id = `render_${docId}_${pageIndex}_${scale}_${canvasId}_${this.requestSeq++}_${Date.now()}`;

      const scaleKey = `${docId}|${pageIndex}`;
      const lastScale = this.lastRenderScaleByDocPage.get(scaleKey);
      if (
        typeof lastScale === "number" &&
        Math.abs(lastScale - scale) > 0.001
      ) {
        this.cancelQueuedRenders({ docId, pageIndex, scale });
      }
      this.lastRenderScaleByDocPage.set(scaleKey, scale);

      if (signal?.aborted) {
        const err = new DOMException("Aborted", "AbortError");
        (err as DOMException & { phase?: string }).phase = "pre-send";
        reject(err);
        return;
      }

      const onAbort = () => {
        const msg: WorkerRequest = { type: "cancel", id };
        this.worker?.postMessage(msg);
        this.pendingRequests.delete(id);
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        this.pendingRequests.set(id, {
          resolve: (msg: WorkerSuccessResponse<"render">) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            resolve(Boolean(msg.payload ?? true));
          },
          reject: (msg: WorkerErrorResponse) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            reject(new Error(msg.error));
          },
        });

        const message: WorkerRequest = {
          type: "render",
          id,
          docId,
          pageIndex,
          scale,
          rotation,
          canvas,
          canvasId,
          priority: priority || 0,
          tile,
        };

        worker.postMessage(message, canvas ? [canvas] : []);
      } catch (e) {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    });
  }
}

export { PDFWorkerService };

export const createPdfWorkerService = () => new PDFWorkerService();

// Legacy convenience callers can still use the singleton; live tabs have
// their own owner. Do not create an idle extra worker at application startup.
export const pdfWorkerService = new PDFWorkerService({ lazy: true });
