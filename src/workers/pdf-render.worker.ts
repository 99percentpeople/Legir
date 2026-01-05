import * as pdfjsLib from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";
import type {
  WorkerErrorResponse,
  WorkerRequest,
  WorkerSuccessResponse,
} from "@/services/pdfService/workerProtocol";

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
const activeRenderTasks = new Map<
  string,
  { cancel: () => void; docId: string }
>();

// Priority Queue Implementation
interface QueueItem {
  id: string;
  priority: number;
  data: Extract<WorkerRequest, { type: "render" | "renderImage" }>;
}
const taskQueue: QueueItem[] = [];
let isProcessing = false;

const buildQueueTaskKey = (
  req: Extract<WorkerRequest, { type: "render" | "renderImage" }>,
): string => {
  const type = req.type;
  const docId = getDocId(req.docId);
  const pageIndex = req.pageIndex ?? -1;
  const scale = typeof req.scale === "number" ? req.scale : -1;
  const canvasId = req.type === "render" ? req.canvasId : "";
  const tile = req.type === "render" && req.tile ? req.tile.join(",") : "";
  const targetWidth =
    req.type === "renderImage" && typeof req.targetWidth === "number"
      ? req.targetWidth
      : -1;
  const mimeType = req.type === "renderImage" ? req.mimeType || "" : "";
  const quality =
    req.type === "renderImage" && typeof req.quality === "number"
      ? req.quality
      : -1;
  return `${type}|${docId}|${pageIndex}|${scale}|${canvasId}|${tile}|${targetWidth}|${mimeType}|${quality}`;
};

const cancelQueuedTasksForDoc = (docId: string) => {
  for (let i = taskQueue.length - 1; i >= 0; i--) {
    const queuedDocId = getDocId(taskQueue[i].data.docId);
    if (queuedDocId !== docId) continue;
    const removed = taskQueue.splice(i, 1)[0];
    if (removed) {
      postSuccess(removed.id, false);
    }
  }
};

const cancelActiveTasksForDoc = (docId: string) => {
  for (const [taskId, task] of Array.from(activeRenderTasks.entries())) {
    if (task.docId !== docId) continue;
    try {
      task.cancel();
    } catch {
      // ignore
    }
    activeRenderTasks.delete(taskId);
  }
};

const postSuccess = <TPayload = unknown>(
  id: string,
  payload?: TPayload,
  transfer?: Transferable[],
) => {
  const msg =
    payload === undefined
      ? ({ id, success: true } as WorkerSuccessResponse)
      : ({ id, success: true, payload } as unknown as WorkerSuccessResponse);
  if (transfer && transfer.length > 0) {
    self.postMessage(msg, { transfer });
  } else {
    self.postMessage(msg);
  }
};

const postError = (id: string, error: string) => {
  const msg: WorkerErrorResponse = { id, success: false, error };
  self.postMessage(msg);
};

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

const getTextContentForPage = async (
  params: Extract<WorkerRequest, { type: "getTextContent" }>,
) => {
  const { id, pageIndex, docId } = params;
  const resolvedDocId = getDocId(docId);

  let isCancelled = false;
  activeRenderTasks.set(id, {
    docId: resolvedDocId,
    cancel: () => {
      isCancelled = true;
    },
  });

  try {
    if (isCancelled) throw { name: "RenderingCancelledException" };
    if (pageIndex === undefined) throw new Error("Missing text parameters");

    await ensureDocumentLoaded(resolvedDocId);
    if (isCancelled) throw { name: "RenderingCancelledException" };

    const page = await getPageForDoc(resolvedDocId, pageIndex);
    if (isCancelled) throw { name: "RenderingCancelledException" };

    const textContent = await page.getTextContent({});
    if (isCancelled) throw { name: "RenderingCancelledException" };

    postSuccess(id, textContent);
  } catch (error: any) {
    if (error?.name === "RenderingCancelledException") {
      postSuccess(id, false);
      return;
    }

    postError(id, error.message || "Unknown error");
  } finally {
    activeRenderTasks.delete(id);
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

const renderToCanvas = async (
  params: Extract<WorkerRequest, { type: "render" }>,
) => {
  const {
    id,
    pageIndex,
    scale,
    tile,
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
    docId: resolvedDocId,
    cancel: () => {
      isCancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
    },
  });

  try {
    if (isCancelled) throw { name: "RenderingCancelledException" };

    await ensureDocumentLoaded(resolvedDocId);
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
    const finalTileX = tile ? tile[0] : 0;
    const finalTileY = tile ? tile[1] : 0;
    const finalTileWidth = tile ? tile[2] : viewport.width;
    const finalTileHeight = tile ? tile[3] : viewport.height;

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
    postSuccess(id, true);
  } catch (error: any) {
    if (error?.name === "RenderingCancelledException") {
      postSuccess(id, false);
      return;
    }

    postError(id, error.message || "Unknown error");
  } finally {
    // Clean up task from map
    activeRenderTasks.delete(id);
  }
};

const renderToImage = async (
  params: Extract<WorkerRequest, { type: "renderImage" }>,
) => {
  const {
    id,
    pageIndex,
    scale,
    targetWidth,
    renderAnnotations,
    mimeType,
    quality,
    docId,
  } = params;

  const resolvedDocId = getDocId(docId);

  let renderTask: pdfjsLib.RenderTask | null = null;
  let isCancelled = false;

  activeRenderTasks.set(id, {
    docId: resolvedDocId,
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

    if (params.isNewDoc) {
      await ensureDocumentLoaded(resolvedDocId, {
        isNewDoc: true,
        data: params.data,
      });
    } else {
      await ensureDocumentLoaded(resolvedDocId);
    }
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

    postSuccess(
      id,
      {
        mimeType: outMimeType,
        imageBytes: buf,
      },
      [buf],
    );
  } catch (error: any) {
    if (error?.name === "RenderingCancelledException") {
      postSuccess(id, false);
      return;
    }

    postError(id, error.message || "Unknown error");
  } finally {
    activeRenderTasks.delete(id);
  }
};

const handleQueuedTask = async (
  data: Extract<WorkerRequest, { type: "render" | "renderImage" }>,
) => {
  if (data.type === "renderImage") {
    await renderToImage(data);
    return;
  }
  await renderToCanvas(data);
};

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { type, id } = e.data;

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

  if (type === "getTextContent") {
    try {
      await getTextContentForPage(e.data);
    } catch (error: any) {
      postError(id, error.message || "Text error");
    }
    return;
  }

  if (type === "load") {
    try {
      const resolvedDocId = getDocId(e.data.docId);
      cancelQueuedTasksForDoc(resolvedDocId);
      cancelActiveTasksForDoc(resolvedDocId);
      await loadDocument(resolvedDocId, e.data.data);
      postSuccess(id, true);
    } catch (error: any) {
      postError(id, error.message || "Load error");
    }
    return;
  }

  if (type === "unload") {
    try {
      const resolvedDocId = getDocId(e.data.docId);
      cancelQueuedTasksForDoc(resolvedDocId);
      cancelActiveTasksForDoc(resolvedDocId);
      await disposeDocument(resolvedDocId);
      postSuccess(id, true);
    } catch (error: any) {
      postError(id, error.message || "Unload error");
    }
    return;
  }

  if (type === "releaseCanvas") {
    const idsToRelease = new Set<string>(e.data.canvasIds);

    if (idsToRelease.size > 0) {
      for (let i = taskQueue.length - 1; i >= 0; i--) {
        const queued = taskQueue[i].data;
        if (queued.type !== "render") continue;
        const cid = queued.canvasId;
        if (!idsToRelease.has(cid)) continue;
        const removed = taskQueue.splice(i, 1)[0];
        if (removed) {
          postSuccess(removed.id, false);
        }
      }
      for (const cid of idsToRelease) {
        canvasMap.delete(cid);
      }
    }

    postSuccess(id, true);
    return;
  }

  if (type === "cancelQueuedRenders") {
    // Optimization: When scale changes, discard all pending tasks with different scale
    // This ensures we don't waste time on tiles that are no longer needed
    const incomingScale = e.data.scale;
    const incomingDocId = getDocId(e.data.docId);
    const incomingPageIndex = e.data.pageIndex;

    if (
      incomingScale !== undefined &&
      incomingPageIndex !== undefined &&
      taskQueue.length > 0
    ) {
      for (let i = taskQueue.length - 1; i >= 0; i--) {
        const queued = taskQueue[i];
        const queuedType = queued.data.type || "render";
        if (queuedType !== "render") continue;

        const taskDocId = getDocId(queued.data.docId);
        if (taskDocId !== incomingDocId) continue;
        if (queued.data.pageIndex !== incomingPageIndex) continue;

        const taskScale = queued.data.scale;
        if (
          taskScale !== undefined &&
          Math.abs(taskScale - incomingScale) > 0.001
        ) {
          const removed = taskQueue.splice(i, 1)[0];
          if (removed) {
            postSuccess(removed.id, false);
          }
        }
      }
    }

    postSuccess(id, true);
    return;
  }

  if (type === "reprioritize") {
    const incomingDocId = getDocId(e.data.docId);
    const incomingPageIndex = e.data.pageIndex;
    const incomingScale = e.data.scale;
    const vc = e.data.viewportCenter;

    if (
      vc &&
      incomingPageIndex !== undefined &&
      incomingScale !== undefined &&
      taskQueue.length > 0
    ) {
      const vcx = vc[0];
      const vcy = vc[1];

      for (const item of taskQueue) {
        if (item.data.type !== "render") continue;
        if (getDocId(item.data.docId) !== incomingDocId) continue;
        if (item.data.pageIndex !== incomingPageIndex) continue;

        const taskScale = item.data.scale;
        if (
          taskScale === undefined ||
          Math.abs(taskScale - incomingScale) > 0.001
        ) {
          continue;
        }

        const t = item.data.tile;
        const cx = t ? t[0] + t[2] / 2 : vcx;
        const cy = t ? t[1] + t[3] / 2 : vcy;
        const newPriority = Math.hypot(cx - vcx, cy - vcy);
        item.priority = newPriority;
        item.data.priority = newPriority;
      }

      taskQueue.sort((a, b) => a.priority - b.priority);
      scheduleNext();
    }

    postSuccess(id, true);
    return;
  }

  if (type === "render" || type === "renderImage") {
    // Early registration of canvas to prevent loss during cancellation or optimization
    if (type === "render" && e.data.canvas) {
      canvasMap.set(e.data.canvasId, e.data.canvas);
    }

    const priority = e.data.priority ?? 0;

    const queuedData = e.data;
    const incomingKey = buildQueueTaskKey(queuedData);
    const existingIndex = taskQueue.findIndex(
      (item) => buildQueueTaskKey(item.data) === incomingKey,
    );
    if (existingIndex > -1) {
      const removed = taskQueue.splice(existingIndex, 1)[0];
      if (removed) {
        postSuccess(removed.id, false);
      }
    }

    // Add to queue
    taskQueue.push({
      id,
      priority,
      data: queuedData,
    });

    // Sort queue: Lower priority value = Higher priority (closer to center)
    taskQueue.sort((a, b) => a.priority - b.priority);

    // Trigger processing
    scheduleNext();
  }
};
