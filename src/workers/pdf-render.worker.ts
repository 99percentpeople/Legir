import * as pdfjsLib from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";

const PDFJS_CMAP_URL = "/pdfjs/cmaps/";
const PDFJS_STANDARD_FONT_URL = "/pdfjs/standard_fonts/";

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker({
  name: "pdfjs-worker-render",
});

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

interface RenderRequest {
  type?: "render" | "cancel" | "load" | "unload" | "renderImage";
  id: string;
  docId?: string;
  data?: Uint8Array | null;
  pageIndex?: number;
  scale?: number;
  targetWidth?: number;
  renderAnnotations?: boolean;
  mimeType?: string;
  quality?: number;
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

type DocState = {
  pdfDoc: pdfjsLib.PDFDocumentProxy | null;
  docLoadingPromise: Promise<pdfjsLib.PDFDocumentProxy> | null;
  pageCache: Map<number, MaybePromise<pdfjsLib.PDFPageProxy>>;
};

const docs = new Map<string, DocState>();

const getDocId = (docId?: string) => docId || "default";

const getDocState = (docId?: string): DocState => {
  const id = getDocId(docId);
  const existing = docs.get(id);
  if (existing) return existing;
  const created: DocState = {
    pdfDoc: null,
    docLoadingPromise: null,
    pageCache: new Map<number, MaybePromise<pdfjsLib.PDFPageProxy>>(),
  };
  docs.set(id, created);
  return created;
};
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
    await handleQueuedTask(item.data);
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

const loadDocument = async (docId: string, data: Uint8Array) => {
  const state = getDocState(docId);
  try {
    await state.pdfDoc?.destroy();
  } catch {}
  state.pageCache.clear();
  const loadingTask = pdfjsLib.getDocument({
    data: data,
    password: "",
    cMapUrl: PDFJS_CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: PDFJS_STANDARD_FONT_URL,
    useSystemFonts: false,
    disableFontFace: false,
  });
  state.docLoadingPromise = loadingTask.promise;
  state.pdfDoc = null;
  state.pdfDoc = await state.docLoadingPromise;
};

const disposeDocument = async (docId: string) => {
  const state = docs.get(docId);
  if (!state) return;
  try {
    await state.pdfDoc?.destroy();
  } catch {}
  docs.delete(docId);
};

const ensureDocumentLoaded = async (
  docId: string,
  options?: {
    isNewDoc?: boolean;
    data?: Uint8Array | null;
  },
) => {
  const state = getDocState(docId);
  if (options?.isNewDoc && options.data) {
    await loadDocument(docId, options.data);
    return;
  }

  if (!state.pdfDoc && state.docLoadingPromise) {
    state.pdfDoc = await state.docLoadingPromise;
    return;
  }

  if (!state.pdfDoc) {
    throw new Error("PDF Document not loaded");
  }
};

const getPageForDoc = async (docId: string, pageIndex: number) => {
  const state = getDocState(docId);
  if (!state.pdfDoc) {
    throw new Error("PDF Document not loaded");
  }

  const pageNumber = pageIndex + 1;
  let pagePromise = state.pageCache.get(pageNumber);
  if (!pagePromise) {
    pagePromise = state.pdfDoc.getPage(pageNumber);
    state.pageCache.set(pageNumber, pagePromise);
  }
  return await pagePromise;
};

const renderToCanvas = async (params: RenderRequest) => {
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
    docId,
    renderAnnotations,
  } = params;

  const resolvedDocId = getDocId(docId);

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

    await ensureDocumentLoaded(resolvedDocId, { isNewDoc, data });
    if (isCancelled) throw { name: "RenderingCancelledException" };

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

    const page = await getPageForDoc(resolvedDocId, pageIndex);
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
      annotationMode: renderAnnotations
        ? pdfjsLib.AnnotationMode.ENABLE
        : pdfjsLib.AnnotationMode.DISABLE,
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

const renderToImage = async (params: RenderRequest) => {
  const {
    id,
    data,
    pageIndex,
    scale,
    targetWidth,
    renderAnnotations,
    mimeType,
    quality,
    isNewDoc,
    docId,
  } = params;

  const resolvedDocId = getDocId(docId);

  let renderTask: pdfjsLib.RenderTask | null = null;
  let isCancelled = false;

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
    if (pageIndex === undefined) throw new Error("Missing render parameters");

    await ensureDocumentLoaded(resolvedDocId, { isNewDoc, data });
    if (isCancelled) throw { name: "RenderingCancelledException" };

    const page = await getPageForDoc(resolvedDocId, pageIndex);
    if (isCancelled) throw { name: "RenderingCancelledException" };

    const baseViewport = page.getViewport({
      scale: 1.0,
      rotation: page.rotate,
    });
    const finalScale =
      typeof scale === "number"
        ? scale
        : typeof targetWidth === "number"
          ? Math.min(1.0, Math.max(0.05, targetWidth / baseViewport.width))
          : 1.0;

    const viewport = page.getViewport({
      scale: finalScale,
      rotation: page.rotate,
    });
    const canvas = new OffscreenCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not get context");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    const annotationMode = renderAnnotations
      ? pdfjsLib.AnnotationMode.ENABLE
      : pdfjsLib.AnnotationMode.DISABLE;

    renderTask = page.render({
      canvas: undefined,
      canvasContext: ctx as any,
      viewport,
      annotationMode,
    });

    await renderTask.promise;
    if (isCancelled) throw { name: "RenderingCancelledException" };

    const outMimeType = mimeType || "image/jpeg";
    const blob = await canvas.convertToBlob({
      type: outMimeType,
      quality: typeof quality === "number" ? quality : 0.8,
    });
    if (isCancelled) throw { name: "RenderingCancelledException" };

    const buf = await blob.arrayBuffer();
    if (isCancelled) throw { name: "RenderingCancelledException" };

    (self as any).postMessage(
      {
        id,
        success: true,
        payload: {
          mimeType: outMimeType,
          imageBytes: buf,
        },
      },
      [buf],
    );
  } catch (error: any) {
    if (error?.name === "RenderingCancelledException") {
      return;
    }

    self.postMessage({
      id,
      success: false,
      error: error.message || "Unknown error",
    });
  } finally {
    activeRenderTasks.delete(id);
  }
};

const handleQueuedTask = async (data: RenderRequest) => {
  const type = data.type || "render";
  if (type === "renderImage") {
    await renderToImage(data);
    return;
  }
  await renderToCanvas(data);
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
      const resolvedDocId = getDocId(e.data.docId);
      if (e.data.data) {
        await loadDocument(resolvedDocId, e.data.data);
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

  if (type === "unload") {
    try {
      const resolvedDocId = getDocId(e.data.docId);
      await disposeDocument(resolvedDocId);
      self.postMessage({ id, success: true });
    } catch (error: any) {
      self.postMessage({
        id,
        success: false,
        error: error.message || "Unload error",
      });
    }
    return;
  }

  if (type === "render" || type === "renderImage") {
    // Early registration of canvas to prevent loss during cancellation or optimization
    if (e.data.canvas && e.data.canvasId) {
      canvasMap.set(e.data.canvasId, e.data.canvas);
    }

    // Optimization: When scale changes, discard all pending tasks with different scale
    // This ensures we don't waste time on tiles that are no longer needed
    const incomingScale = e.data.scale;
    const incomingPriority = priority;
    const incomingDocId = getDocId(e.data.docId);

    if (incomingScale !== undefined) {
      for (let i = taskQueue.length - 1; i >= 0; i--) {
        const taskScale = taskQueue[i].data.scale;
        const taskPriority = taskQueue[i].priority;
        const taskDocId = getDocId(taskQueue[i].data.docId);

        if (
          taskDocId === incomingDocId &&
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
