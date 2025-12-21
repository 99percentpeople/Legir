import * as pdfjsLib from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";

const PDFJS_CMAP_URL = "/pdfjs/cmaps/";
const PDFJS_STANDARD_FONT_URL = "/pdfjs/standard_fonts/";

// Polyfill document for pdf.js font rendering in worker
if (typeof self.document === "undefined") {
  const fakeOwnerDocument = {
    createElement: (name: string) => {
      if (name === "canvas") {
        return new OffscreenCanvas(1, 1);
      }
      return null;
    },
    // 模拟 fonts 对象
    fonts: (self as any).fonts,
  };
  (self as any).document = fakeOwnerDocument;
}

// Set up worker for the worker thread
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker({
  name: "pdfjs-worker-render",
});

interface RenderRequest {
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
  priority?: number; // Lower number = higher priority
}

type MaybePromise<T> = T | Promise<T>;

let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
let docLoadingPromise: Promise<pdfjsLib.PDFDocumentProxy> | null = null;
const pageCache = new Map<number, MaybePromise<pdfjsLib.PDFPageProxy>>();
const canvasMap = new Map<string, OffscreenCanvas>();

// Store active render tasks to allow cancellation
const activeRenderTasks = new Map<string, { cancel: () => void }>();

// Priority Queue Implementation
interface QueueItem {
  id: string;
  priority: number;
  data: RenderRequest;
}
const taskQueue: QueueItem[] = [];
let isProcessing = false;

// Process the next task in the queue
const processQueue = async () => {
  if (isProcessing || taskQueue.length === 0) return;

  isProcessing = true;
  // Get the highest priority task (lowest distance value)
  const item = taskQueue.shift();

  if (!item) {
    isProcessing = false;
    return;
  }

  try {
    await renderPage(item.data);
  } catch (err) {
    console.error("Error processing task:", err);
  } finally {
    isProcessing = false;
    // Schedule next processing
    scheduleNext();
  }
};

// MessageChannel for high-priority scheduling
const channel = new MessageChannel();
const port = channel.port2;
channel.port1.onmessage = processQueue;

const scheduleNext = () => {
  if (isProcessing || taskQueue.length === 0) return;

  // Use MessageChannel for all tasks
  // This ensures minimal latency while yielding to the event loop
  // so we can still handle 'cancel' or other messages.
  port.postMessage(null);
};

const loadDocument = async (data: Uint8Array) => {
  pageCache.clear();
  const loadingTask = pdfjsLib.getDocument({
    data: data,
    password: "",
    cMapUrl: PDFJS_CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: PDFJS_STANDARD_FONT_URL,
    useSystemFonts: false,
    disableFontFace: false,
  });
  docLoadingPromise = loadingTask.promise;
  pdfDoc = null; // Reset current doc while loading
  pdfDoc = await docLoadingPromise;
};

// Separated render logic
const renderPage = async (params: RenderRequest) => {
  const {
    id,
    data,
    pageIndex,
    scale,
    tileX,
    tileY,
    tileWidth,
    tileHeight,
    isNewDoc,
    canvas: transferredCanvas,
    canvasId,
  } = params;

  let renderTask: pdfjsLib.RenderTask | null = null;
  let isCancelled = false;

  // Register cancellation handler immediately to catch early cancels
  activeRenderTasks.set(id, {
    cancel: () => {
      isCancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
    },
  });

  try {
    if (isCancelled) throw { name: "RenderingCancelledException" };

    // Load Document if needed
    if (isNewDoc && data) {
      await loadDocument(data);
    }
    if (isCancelled) throw { name: "RenderingCancelledException" };

    // Wait for loading if it's in progress
    if (!pdfDoc && docLoadingPromise) {
      pdfDoc = await docLoadingPromise;
    }
    if (isCancelled) throw { name: "RenderingCancelledException" };

    if (!pdfDoc) {
      throw new Error("PDF Document not loaded");
    }

    // Resolve Canvas
    let targetCanvas: OffscreenCanvas | undefined = transferredCanvas;
    if (canvasId) {
      if (transferredCanvas) {
        // Register new canvas
        canvasMap.set(canvasId, transferredCanvas);
      } else {
        // Retrieve existing canvas
        targetCanvas = canvasMap.get(canvasId);
      }
    }

    // Ensure we have all required parameters for render
    if (pageIndex === undefined || scale === undefined || !targetCanvas) {
      throw new Error("Missing render parameters");
    }

    // Get page from cache or load it
    const pageNumber = pageIndex + 1;
    let pagePromise = pageCache.get(pageNumber);
    if (!pagePromise) {
      pagePromise = pdfDoc.getPage(pageNumber);
      pageCache.set(pageNumber, pagePromise);
    }
    const page = await pagePromise;
    if (isCancelled) throw { name: "RenderingCancelledException" };

    // Calculate viewport
    const viewport = page.getViewport({ scale: scale, rotation: page.rotate });

    // Determine tile parameters with defaults
    const finalTileX = tileX ?? 0;
    const finalTileY = tileY ?? 0;
    const finalTileWidth = tileWidth ?? viewport.width;
    const finalTileHeight = tileHeight ?? viewport.height;

    // Resize canvas to match tile size (crucial for OffscreenCanvas)
    if (
      targetCanvas.width !== finalTileWidth ||
      targetCanvas.height !== finalTileHeight
    ) {
      targetCanvas.width = finalTileWidth;
      targetCanvas.height = finalTileHeight;
    }

    // Use transferred OffscreenCanvas
    const ctx = targetCanvas.getContext("2d", { alpha: false });

    if (!ctx) {
      throw new Error("Could not get context");
    }

    // Set white background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, finalTileWidth, finalTileHeight);

    // Transform context to draw the correct tile
    ctx.save();
    ctx.translate(-finalTileX, -finalTileY);

    const renderContext = {
      canvas: undefined,
      canvasContext: ctx as any, // Type cast for OffscreenCanvasRenderingContext2D compatibility
      viewport: viewport,
      annotationMode: pdfjsLib.AnnotationMode.DISABLE,
    };

    if (isCancelled) throw { name: "RenderingCancelledException" };

    renderTask = page.render(renderContext);

    await renderTask.promise;

    ctx.restore();

    // No need to transfer bitmap back, canvas is already updated
    self.postMessage({ id, success: true });
  } catch (error: any) {
    if (error?.name === "RenderingCancelledException") {
      // Ignore cancelled errors
      return;
    }

    self.postMessage({
      id,
      success: false,
      error: error.message || "Unknown error",
    });
  } finally {
    // Clean up task from map
    activeRenderTasks.delete(id);
  }
};

self.onmessage = async (e: MessageEvent<RenderRequest>) => {
  const {
    type = "render",
    id,
    priority = 0, // Default priority
  } = e.data;

  if (type === "cancel") {
    // 1. Check if it's in the queue and remove it
    const queueIndex = taskQueue.findIndex((item) => item.id === id);
    if (queueIndex > -1) {
      taskQueue.splice(queueIndex, 1);
      // console.log(`Task ${id} removed from queue (cancelled)`);
    }

    // 2. Check if it's currently running and cancel it
    const task = activeRenderTasks.get(id);
    if (task) {
      task.cancel();
      activeRenderTasks.delete(id);
    }
    return;
  }

  if (type === "load") {
    try {
      if (e.data.data) {
        await loadDocument(e.data.data);
        self.postMessage({ id, success: true });
      } else {
        throw new Error("No data provided for load");
      }
    } catch (error: any) {
      self.postMessage({
        id,
        success: false,
        error: error.message || "Load error",
      });
    }
    return;
  }

  if (type === "render") {
    // Early registration of canvas to prevent loss during cancellation or optimization
    if (e.data.canvas && e.data.canvasId) {
      canvasMap.set(e.data.canvasId, e.data.canvas);
    }

    // Optimization: When scale changes, discard all pending tasks with different scale
    // This ensures we don't waste time on tiles that are no longer needed
    const incomingScale = e.data.scale;
    const incomingPriority = priority;

    if (incomingScale !== undefined) {
      for (let i = taskQueue.length - 1; i >= 0; i--) {
        const taskScale = taskQueue[i].data.scale;
        const taskPriority = taskQueue[i].priority;

        if (
          taskScale !== undefined &&
          Math.abs(taskScale - incomingScale) > 0.001 &&
          taskPriority === incomingPriority
        ) {
          taskQueue.splice(i, 1);
        }
      }
    }

    // Add to queue
    taskQueue.push({
      id,
      priority,
      data: e.data,
    });

    // Sort queue: Lower priority value = Higher priority (closer to center)
    taskQueue.sort((a, b) => a.priority - b.priority);

    // Trigger processing
    scheduleNext();
  }
};
