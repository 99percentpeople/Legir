import PDFRenderWorker from "@/workers/pdf-render.worker?worker";
import type { Tile } from "./types";
import type { TextContent } from "pdfjs-dist/types/src/display/api";
import type { PDFOutlineItem } from "@/types";
import type {
  WorkerCommandType,
  WorkerErrorResponse,
  WorkerRequest,
  WorkerResponse,
  WorkerSuccessResponse,
} from "./workerProtocol";

type WorkerHost = {
  worker: Worker | null;
  initWorker: () => void;
};

const RequireWorkerPromise = (throwError = true) => {
  return <T extends (...args: unknown[]) => Promise<unknown>>(
    _target: unknown,
    _propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>,
  ) => {
    const original = descriptor.value;
    if (!original) return;

    const wrapped = function (this: WorkerHost, ...args: Parameters<T>) {
      if (!this.worker) {
        this.initWorker();
        if (!this.worker) {
          if (throwError) {
            return Promise.reject(
              new Error("Worker not initialized"),
            ) as ReturnType<T>;
          } else {
            return;
          }
        }
      }
      return original.apply(this as unknown as ThisParameterType<T>, args);
    } as T;

    descriptor.value = wrapped;
  };
};

const RequireWorkerVoid = () => {
  return <T extends (...args: unknown[]) => void>(
    _target: unknown,
    _propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>,
  ) => {
    const original = descriptor.value;
    if (!original) return;

    const wrapped = function (this: WorkerHost, ...args: Parameters<T>) {
      if (!this.worker) {
        this.initWorker();
        if (!this.worker) {
          return;
        }
      }
      return original.apply(this as unknown as ThisParameterType<T>, args);
    } as T;

    descriptor.value = wrapped;
  };
};

type PendingRequestHandlers<TType extends WorkerCommandType> = {
  resolve: (msg: WorkerSuccessResponse<TType>) => void;
  reject: (msg: WorkerErrorResponse) => void;
};

class PDFWorkerService {
  private worker: Worker | null = null;
  private pendingRequests = new Map<
    string,
    PendingRequestHandlers<WorkerCommandType>
  >();
  private requestSeq = 0;

  private passwordByDocId = new Map<string, string>();

  private readonly defaultDocId: string = "default";

  private lastRenderScaleByDocPage = new Map<string, number>();
  private textContentCacheByDocPage = new Map<string, TextContent>();
  private outlineCacheByDocId = new Map<string, PDFOutlineItem[]>();

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

  constructor() {
    this.initWorker();
  }

  @RequireWorkerPromise()
  public reprioritize(options: {
    pageIndex: number;
    scale: number;
    viewportCenter: [number, number];
    docId?: string;
    signal?: AbortSignal;
  }): Promise<boolean> {
    return new Promise((resolve, reject) => {
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

        this.worker.postMessage(message);
      } catch (e) {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    });
  }

  private initWorker() {
    try {
      this.worker = new PDFRenderWorker();
      if (this.worker) {
        this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
          const msg = e.data;
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
      }
    } catch (e) {
      console.error("Failed to initialize PDF Worker", e);
    }
  }

  @RequireWorkerPromise()
  public loadDocument(
    data: Uint8Array,
    options?: { docId?: string; signal?: AbortSignal; password?: string },
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
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
            resolve(Boolean(msg.payload ?? true));
          },
          reject: (msg: WorkerErrorResponse) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            reject(new Error(msg.error));
          },
        });

        const message: WorkerRequest = {
          type: "load",
          id,
          docId,
          data,
          password,
        };

        this.worker.postMessage(message);
      } catch (e) {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    });
  }

  @RequireWorkerVoid()
  public unloadDocument(docId: string) {
    this.clearLastRenderScaleForDoc(docId);
    this.passwordByDocId.delete(docId);
    this.clearTextContentCacheForDoc(docId);
    this.clearOutlineCacheForDoc(docId);
    const id = `unload_${docId}_${Date.now()}`;
    const message: WorkerRequest = { type: "unload", id, docId };
    this.worker.postMessage(message);
  }

  @RequireWorkerPromise()
  public getTextContent(options: {
    pageIndex: number;
    docId?: string;
    signal?: AbortSignal;
  }): Promise<TextContent | null> {
    return new Promise((resolve, reject) => {
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

        this.worker.postMessage(message);
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

        this.worker.postMessage(message);
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

        this.worker.postMessage(message);
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
    this.worker.postMessage(message);
  }

  @RequireWorkerPromise()
  public releaseCanvas(options: {
    canvasIds: string[];
    signal?: AbortSignal;
  }): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const { canvasIds, signal } = options;
      const id = `releaseCanvas_${Date.now()}`;

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
            reject(new Error(msg.error));
          },
        });

        const message: WorkerRequest = {
          type: "releaseCanvas",
          id,
          canvasIds,
        };

        this.worker.postMessage(message);
      } catch (e) {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    });
  }

  @RequireWorkerPromise()
  public renderPageImage(options: {
    pageIndex: number;
    scale?: number;
    targetWidth?: number;
    renderAnnotations?: boolean;
    mimeType?: string;
    quality?: number;
    priority?: number;
    docId?: string;
    data?: Uint8Array;
    isNewDoc?: boolean;
    password?: string;
    signal?: AbortSignal;
  }): Promise<{ bytes: Uint8Array; mimeType: string }> {
    return new Promise((resolve, reject) => {
      const {
        pageIndex,
        scale,
        targetWidth,
        renderAnnotations,
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
            renderAnnotations,
            mimeType,
            quality,
            priority: priority || 0,
          };
          this.worker.postMessage(message);
        } else {
          const message: WorkerRequest = {
            type: "renderImage",
            id,
            docId,
            pageIndex,
            scale,
            targetWidth,
            renderAnnotations,
            mimeType,
            quality,
            priority: priority || 0,
          };
          this.worker.postMessage(message);
        }
      } catch (e) {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    });
  }

  @RequireWorkerPromise()
  public renderPage(options: {
    pageIndex: number;
    scale: number;
    canvas?: OffscreenCanvas;
    canvasId: string;
    priority?: number;
    /** Defaults to full page if not provided */
    tile?: Tile;
    docId?: string;
    signal?: AbortSignal;
  }): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const {
        pageIndex,
        scale,
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
          canvas,
          canvasId,
          priority: priority || 0,
          tile,
        };

        this.worker.postMessage(message, canvas ? [canvas] : undefined);
      } catch (e) {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    });
  }
}

export const pdfWorkerService = new PDFWorkerService();
