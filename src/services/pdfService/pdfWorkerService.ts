import PDFRenderWorker from "@/workers/pdf-render.worker?worker";
import { Tile } from "./types";

export interface RenderRequest {
  type?:
    | "render"
    | "cancel"
    | "load"
    | "unload"
    | "renderImage"
    | "releaseCanvas"
    | "reprioritize";
  id: string;
  docId?: string;
  data?: Uint8Array | null;
  pageIndex?: number;
  scale?: number;
  targetWidth?: number;
  renderAnnotations?: boolean;
  mimeType?: string;
  quality?: number;
  tile?: Tile;
  viewportCenter?: [number, number];
  isNewDoc?: boolean;
  canvas?: OffscreenCanvas;
  canvasId?: string;
  canvasIds?: string[];
  priority?: number;
}

class PDFWorkerService {
  private worker: Worker | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (val: any) => void; reject: (err: any) => void }
  >();
  private requestSeq = 0;

  private readonly defaultDocId: string = "default";

  constructor() {
    this.initWorker();
  }

  public reprioritize(options: {
    pageIndex: number;
    scale: number;
    viewportCenter: [number, number];
    docId?: string;
    signal?: AbortSignal;
  }): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        this.initWorker();
        if (!this.worker) {
          reject(new Error("Worker not initialized"));
          return;
        }
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
        (err as any).phase = "pre-send";
        reject(err);
        return;
      }

      const onAbort = () => {
        this.worker?.postMessage({ type: "cancel", id });
        this.pendingRequests.delete(id);
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        this.pendingRequests.set(id, {
          resolve: (val) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            resolve(Boolean(val));
          },
          reject: (err) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            reject(err);
          },
        });

        const message: RenderRequest = {
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
        this.worker.onmessage = (e) => {
          const { id, success, error, payload } = e.data;
          const request = this.pendingRequests.get(id);
          if (request) {
            if (success) {
              request.resolve(payload ?? true);
            } else {
              request.reject(new Error(error || "Worker error"));
            }
            this.pendingRequests.delete(id);
          }
        };
      }
    } catch (e) {
      console.error("Failed to initialize PDF Worker", e);
    }
  }

  public loadDocument(
    data: Uint8Array,
    options?: { docId?: string; signal?: AbortSignal },
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        this.initWorker();
        if (!this.worker) {
          reject(new Error("Worker not initialized"));
          return;
        }
      }

      const docId = options?.docId ?? this.defaultDocId;

      const id = `load_${docId}_${Date.now()}`;
      const signal = options?.signal;

      if (signal?.aborted) {
        const err = new DOMException("Aborted", "AbortError");
        (err as any).phase = "pre-send";
        reject(err);
        return;
      }

      const onAbort = () => {
        this.worker?.postMessage({ type: "cancel", id });
        this.pendingRequests.delete(id);
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        this.pendingRequests.set(id, {
          resolve: (val) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            resolve(Boolean(val));
          },
          reject: (err) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            reject(err);
          },
        });

        const message: RenderRequest = {
          type: "load",
          id,
          docId,
          data,
        };

        this.worker.postMessage(message);
      } catch (e) {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    });
  }

  public unloadDocument(docId: string) {
    if (!this.worker) this.initWorker();
    if (!this.worker) return;
    const id = `unload_${docId}_${Date.now()}`;
    const message: RenderRequest = { type: "unload", id, docId };
    this.worker.postMessage(message);
  }

  public releaseCanvas(options: {
    canvasIds: string[];
    signal?: AbortSignal;
  }): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        this.initWorker();
        if (!this.worker) {
          reject(new Error("Worker not initialized"));
          return;
        }
      }

      const { canvasIds, signal } = options;
      const id = `releaseCanvas_${Date.now()}`;

      if (signal?.aborted) {
        const err = new DOMException("Aborted", "AbortError");
        (err as any).phase = "pre-send";
        reject(err);
        return;
      }

      const onAbort = () => {
        this.worker?.postMessage({ type: "cancel", id });
        this.pendingRequests.delete(id);
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        this.pendingRequests.set(id, {
          resolve: (val) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            resolve(Boolean(val));
          },
          reject: (err) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            reject(err);
          },
        });

        const message: RenderRequest = {
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
    signal?: AbortSignal;
  }): Promise<{ bytes: Uint8Array; mimeType: string }> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        this.initWorker();
        if (!this.worker) {
          reject(new Error("Worker not initialized"));
          return;
        }
      }

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
        signal,
      } = options;

      const docId = requestedDocId ?? this.defaultDocId;

      const id = `renderImage_${docId}_${pageIndex}_${this.requestSeq++}_${Date.now()}`;

      if (signal?.aborted) {
        const err = new DOMException("Aborted", "AbortError");
        (err as any).phase = "pre-send";
        reject(err);
        return;
      }

      const onAbort = () => {
        this.worker?.postMessage({ type: "cancel", id });
        this.pendingRequests.delete(id);
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        this.pendingRequests.set(id, {
          resolve: (payload) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            const outMime =
              (payload as any)?.mimeType || mimeType || "image/jpeg";
            const bytesBuf = (payload as any)?.imageBytes as
              | ArrayBuffer
              | undefined;
            if (!bytesBuf) {
              resolve({ bytes: new Uint8Array(), mimeType: outMime });
              return;
            }
            resolve({ bytes: new Uint8Array(bytesBuf), mimeType: outMime });
          },
          reject: (err) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            reject(err);
          },
        });

        const message: RenderRequest = {
          type: "renderImage",
          id,
          docId,
          data: data ?? null,
          isNewDoc,
          pageIndex,
          scale,
          targetWidth,
          renderAnnotations,
          mimeType,
          quality,
          priority: priority || 0,
        };

        this.worker.postMessage(message);
      } catch (e) {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    });
  }

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
      if (!this.worker) {
        this.initWorker();
        if (!this.worker) {
          reject(new Error("Worker not initialized"));
          return;
        }
      }

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

      if (signal?.aborted) {
        const err = new DOMException("Aborted", "AbortError");
        (err as any).phase = "pre-send";
        reject(err);
        return;
      }

      const onAbort = () => {
        this.worker?.postMessage({ type: "cancel", id });
        this.pendingRequests.delete(id);
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        this.pendingRequests.set(id, {
          resolve: (val) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            resolve(val);
          },
          reject: (err) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            reject(err);
          },
        });

        const message: RenderRequest = {
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
