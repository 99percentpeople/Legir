import PDFRenderWorker from "../workers/pdf-render.worker?worker";

export interface RenderRequest {
  type?: "render" | "cancel" | "load";
  id: string;
  data?: Uint8Array | null;
  pageIndex?: number;
  scale?: number;
  tileX?: number;
  tileY?: number;
  tileWidth?: number;
  tileHeight?: number;
  isNewDoc?: boolean;
  canvas?: OffscreenCanvas;
  canvasId?: string;
  priority?: number;
}

class PDFWorkerService {
  private worker: Worker | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (val: boolean) => void; reject: (err: any) => void }
  >();

  constructor() {
    this.initWorker();
  }

  private initWorker() {
    try {
      // @ts-ignore
      this.worker = new PDFRenderWorker();
      if (this.worker) {
        this.worker.onmessage = (e) => {
          const { id, success, error } = e.data;
          const request = this.pendingRequests.get(id);
          if (request) {
            if (success) {
              request.resolve(true);
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

  public loadDocument(data: Uint8Array) {
    if (!this.worker) this.initWorker();
    if (!this.worker) return;

    const id = "load_" + Date.now();
    this.worker.postMessage({
      type: "load",
      id,
      data,
    });
  }

  public renderPage(options: {
    pageIndex: number;
    scale: number;
    canvas?: OffscreenCanvas;
    canvasId: string;
    priority?: number;
    tileWidth?: number;
    tileHeight?: number;
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

      const { pageIndex, scale, canvas, canvasId, priority, tileWidth, tileHeight, signal } = options;
      const id = `render_${pageIndex}_${scale}_${Date.now()}`;

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
          } 
        });

        const message: RenderRequest = {
          type: "render",
          id,
          pageIndex,
          scale,
          canvas,
          canvasId,
          priority: priority || 0,
          tileX: 0,
          tileY: 0,
          tileWidth,
          tileHeight,
        };

        if (canvas) {
          message.tileWidth = tileWidth ?? canvas.width;
          message.tileHeight = tileHeight ?? canvas.height;
        }

        this.worker.postMessage(message, canvas ? [canvas] : []);
      } catch (e) {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    });
  }
}

export const pdfWorkerService = new PDFWorkerService();
