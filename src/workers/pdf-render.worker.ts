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

type FakeNode = {
  nodeName: string;
  style: Record<string, string>;
  parentNode: FakeNode | null;
  childNodes: unknown[];
  appendChild: (child: unknown) => void;
  removeChild: (child: unknown) => void;
  insertBefore: (child: unknown, before: unknown | null) => void;
  append: (...children: unknown[]) => void;
  remove(): void;

  setAttribute: (name: string, value: string) => void;
  setAttributeNS: (ns: string | null, name: string, value: string) => void;
};

type DocumentPolyfillUsage = {
  enabled: boolean;
  calls: Record<string, number>;
};

const documentPolyfillUsage: DocumentPolyfillUsage = {
  enabled: false,
  calls: {
    createElement: 0,
    createElementNS: 0,
    createDocumentFragment: 0,
    createTextNode: 0,
    append: 0,
    appendChild: 0,
    insertBefore: 0,
    removeChild: 0,
    setAttribute: 0,
    setAttributeNS: 0,
  },
};

const shouldLogDocumentPolyfillUse = import.meta.env.DEV === true;
const maybeLogDocumentPolyfillUse = (method: string, data?: unknown) => {
  documentPolyfillUsage.calls[method] += 1;
  if (!shouldLogDocumentPolyfillUse) return;
  console.debug("[worker] document polyfill used", { method, data });
};

const getDocumentPolyfillUsageSnapshot = () => ({
  enabled: documentPolyfillUsage.enabled,
  calls: { ...documentPolyfillUsage.calls },
});

// Polyfill document for pdf.js font rendering in worker
if (typeof self.document === "undefined") {
  documentPolyfillUsage.enabled = true;

  const createFakeNode = (nodeName: string): FakeNode => {
    const node: FakeNode = {
      nodeName,
      style: {},
      parentNode: null,
      childNodes: [],
      appendChild: (child) => {
        maybeLogDocumentPolyfillUse("appendChild", child);

        if (child && typeof child === "object") {
          (child as FakeNode).parentNode = node;
        }
        (node as FakeNode).childNodes.push(child);
        return child;
      },
      removeChild: (child) => {
        maybeLogDocumentPolyfillUse("removeChild", child);

        const idx = node.childNodes.indexOf(child);
        if (idx >= 0) node.childNodes.splice(idx, 1);
        if (child && typeof child === "object") {
          (child as FakeNode).parentNode = null;
        }
      },
      insertBefore: (child, before) => {
        maybeLogDocumentPolyfillUse("insertBefore", { child, before });

        if (child && typeof child === "object") {
          (child as FakeNode).parentNode = node;
        }
        if (!before) {
          node.childNodes.push(child);
          return child;
        }
        const idx = node.childNodes.indexOf(before);
        if (idx >= 0) node.childNodes.splice(idx, 0, child);
        else node.childNodes.push(child);
        return child;
      },
      append: (...children) => {
        maybeLogDocumentPolyfillUse("append", { children });

        for (const c of children) node.appendChild(c);
      },
      remove: () => {
        maybeLogDocumentPolyfillUse("remove");
        node.parentNode?.removeChild(node);
      },
      setAttribute: (name, value) => {
        maybeLogDocumentPolyfillUse("setAttribute", {
          name,
          value,
        });
      },
      setAttributeNS: (ns, name, value) => {
        maybeLogDocumentPolyfillUse("setAttributeNS", {
          ns,
          name,
          value,
        });
      },
    };
    return node;
  };

  const documentElement = createFakeNode("documentElement");
  const head = createFakeNode("head");
  const body = createFakeNode("body");

  documentElement.appendChild(head);
  documentElement.appendChild(body);

  const fakeOwnerDocument = {
    documentElement,
    head,
    body,
    createElement: (name: string) => {
      maybeLogDocumentPolyfillUse("createElement", { name });
      if (name === "canvas") {
        return new OffscreenCanvas(1, 1);
      }
      return createFakeNode(name);
    },
    createElementNS: (ns: string, name: string) => {
      maybeLogDocumentPolyfillUse("createElementNS", { ns, name });
      return fakeOwnerDocument.createElement(name);
    },
    createDocumentFragment: () => {
      maybeLogDocumentPolyfillUse("createDocumentFragment");
      return createFakeNode("#document-fragment");
    },
    createTextNode: (text: string) => {
      maybeLogDocumentPolyfillUse("createTextNode", { text });
      return { nodeName: "#text", textContent: text };
    },
    fonts: (self as unknown as { fonts?: unknown }).fonts,
  };

  (self as any).document = fakeOwnerDocument;
}

type MaybePromise<T> = T | Promise<T>;

type DocState = {
  loadingTask: pdfjsLib.PDFDocumentLoadingTask | null;
  pdfDoc: pdfjsLib.PDFDocumentProxy | null;
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
    loadingTask: null,
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

const registerCancellableTask = (
  id: string,
  docId: string,
  onCancel?: () => void,
) => {
  let isCancelled = false;
  activeRenderTasks.set(id, {
    docId,
    cancel: () => {
      isCancelled = true;
      try {
        onCancel?.();
      } catch {
        // ignore
      }
    },
  });

  const throwIfCancelled = () => {
    if (isCancelled)
      throw new pdfjsLib.RenderingCancelledException("Rendering cancelled");
  };

  const cleanup = () => {
    activeRenderTasks.delete(id);
  };

  return { throwIfCancelled, cleanup };
};

// Priority Queue Implementation
interface QueueItem {
  id: string;
  priority: number;
  data: Extract<WorkerRequest, { type: "render" | "renderImage" }>;
}
const taskQueue: QueueItem[] = [];
let isProcessing = false;

type TaskResult = {
  payload?: unknown;
  transfer?: Transferable[];
};

const pendingSuccessResponses: Array<{
  id: string;
  payload?: unknown;
  transfer?: Transferable[];
}> = [];

const queueSuccessResponse = (
  id: string,
  payload?: unknown,
  transfer?: Transferable[],
) => {
  pendingSuccessResponses.push({ id, payload, transfer });
};

const flushPendingSuccessResponses = () => {
  while (pendingSuccessResponses.length > 0) {
    const next = pendingSuccessResponses.shift();
    if (!next) continue;
    postSuccess(next.id, next.payload, next.transfer);
  }
};

const buildQueueTaskKey = (
  req: Extract<WorkerRequest, { type: "render" | "renderImage" }>,
): string => {
  const type = req.type;
  const docId = getDocId(req.docId);
  const pageIndex = req.pageIndex ?? -1;
  const scale = typeof req.scale === "number" ? req.scale : -1;
  const renderAnnotations = req.renderAnnotations === true ? "1" : "0";
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
  return `${type}|${docId}|${pageIndex}|${scale}|${renderAnnotations}|${canvasId}|${tile}|${targetWidth}|${mimeType}|${quality}`;
};

const cancelQueuedTasksForDoc = (docId: string) => {
  const removedIds: string[] = [];
  for (let i = taskQueue.length - 1; i >= 0; i--) {
    const queued = taskQueue[i].data;
    const queuedDocId = getDocId(queued.docId);
    if (queuedDocId !== docId) continue;
    const removed = taskQueue.splice(i, 1)[0];
    if (removed) {
      removedIds.push(removed.id);
    }
  }
  return removedIds;
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
  const item = taskQueue.shift();
  if (!item) return;
  await handleQueuedTask(item.data);
};

const getTextContentForPage = async (
  params: Extract<WorkerRequest, { type: "getTextContent" }>,
) => {
  const { id, pageIndex, docId } = params;
  const resolvedDocId = getDocId(docId);

  const { throwIfCancelled, cleanup } = registerCancellableTask(
    id,
    resolvedDocId,
  );

  try {
    throwIfCancelled();
    if (pageIndex === undefined) throw new Error("Missing text parameters");

    await ensureDocumentLoaded(resolvedDocId);
    throwIfCancelled();

    const page = await getPageForDoc(resolvedDocId, pageIndex);
    throwIfCancelled();

    const textContent = await page.getTextContent({}).catch((e) => {
      throw new Error("[worker] Failed to getTextContent: " + e.message);
    });
    throwIfCancelled();

    return { payload: textContent } satisfies TaskResult;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "RenderingCancelledException"
    ) {
      return { payload: false } satisfies TaskResult;
    }

    throw error;
  } finally {
    cleanup();
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

const loadDocument = async (
  docId: string,
  data: Uint8Array,
  password?: string,
) => {
  const state = getDocState(docId);

  if (state.loadingTask) {
    try {
      await state.loadingTask?.destroy();
    } finally {
      state.loadingTask = null;
    }
  }

  try {
    await state.pdfDoc?.destroy();
  } finally {
    state.pdfDoc = null;
  }
  state.pageCache.clear();
  const loadingTask = pdfjsLib.getDocument({
    data: data,
    password: password || "",
    cMapUrl: PDFJS_CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: PDFJS_STANDARD_FONT_URL,
    useSystemFonts: false,
    disableFontFace: false,
    stopAtErrors: false,
  });

  if (typeof password === "string") {
    let didTry = false;
    loadingTask.onPassword = (cb: (password: string) => void) => {
      if (didTry) {
        void loadingTask.destroy().catch(() => {});
        cb("");
        return;
      }
      didTry = true;
      cb(password);
    };
  }
  state.loadingTask = loadingTask;

  try {
    state.pdfDoc = await state.loadingTask.promise;
  } catch (e) {
    await loadingTask.destroy().catch(() => {});
    throw new Error("[worker] Failed to load document: " + e.message);
  }
};

const disposeDocument = async (docId: string) => {
  const state = docs.get(docId);
  if (!state) return;
  docs.delete(docId);

  try {
    state.loadingTask?.destroy();
  } finally {
    state.loadingTask = null;
  }

  try {
    await state.pdfDoc?.destroy();
  } finally {
    state.pdfDoc = null;
  }

  state.pageCache.clear();
};

const ensureDocumentLoaded = async (
  docId: string,
  options?: {
    isNewDoc?: boolean;
    data?: Uint8Array | null;
    password?: string;
  },
) => {
  const state = getDocState(docId);
  if (options?.isNewDoc && options.data) {
    await loadDocument(docId, options.data, options.password);
    return;
  }
  if (state.pdfDoc) return;

  if (state.loadingTask) {
    state.pdfDoc = await state.loadingTask.promise;
    return;
  }

  throw new Error("PDF Document not loaded");
};

const getPageForDoc = async (docId: string, pageIndex: number) => {
  const state = getDocState(docId);
  if (!state.pdfDoc) {
    throw new Error("PDF Document not loaded");
  }

  const pageNumber = pageIndex + 1;
  try {
    let pagePromise = state.pageCache.get(pageNumber);
    if (!pagePromise) {
      pagePromise = state.pdfDoc.getPage(pageNumber);
      state.pageCache.set(pageNumber, pagePromise);
    }

    return await pagePromise;
  } catch (e) {
    throw new Error("[worker] failed to getPage: " + e.message);
  }
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

  const { throwIfCancelled, cleanup } = registerCancellableTask(
    id,
    resolvedDocId,
    () => {
      renderTask?.cancel();
    },
  );

  try {
    throwIfCancelled();

    await ensureDocumentLoaded(resolvedDocId);
    throwIfCancelled();

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
    throwIfCancelled();

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

    throwIfCancelled();

    renderTask = page.render(renderContext);

    await renderTask.promise;

    ctx.restore();

    // No need to transfer bitmap back, canvas is already updated
    return { payload: true } satisfies TaskResult;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "RenderingCancelledException"
    ) {
      return { payload: false } satisfies TaskResult;
    }

    throw error;
  } finally {
    cleanup();
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

  const { throwIfCancelled, cleanup } = registerCancellableTask(
    id,
    resolvedDocId,
    () => {
      renderTask?.cancel();
    },
  );

  try {
    throwIfCancelled();
    if (pageIndex === undefined) throw new Error("Missing render parameters");

    if (params.isNewDoc) {
      await ensureDocumentLoaded(resolvedDocId, {
        isNewDoc: true,
        data: params.data,
        password: params.password,
      });
    } else {
      await ensureDocumentLoaded(resolvedDocId);
    }
    throwIfCancelled();
    const page = await getPageForDoc(resolvedDocId, pageIndex);
    throwIfCancelled();

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
    throwIfCancelled();

    const outMimeType = mimeType || "image/jpeg";
    const blob = await canvas.convertToBlob({
      type: outMimeType,
      quality: typeof quality === "number" ? quality : 0.8,
    });
    throwIfCancelled();

    const buf = await blob.arrayBuffer();
    throwIfCancelled();

    return {
      payload: {
        mimeType: outMimeType,
        imageBytes: buf,
      },
      transfer: [buf],
    } satisfies TaskResult;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "RenderingCancelledException"
    ) {
      return { payload: false } satisfies TaskResult;
    }

    console.error("[worker] renderImage error", {
      id,
      docId: resolvedDocId,
      pageIndex,
      message: error?.message,
      name: error?.name,
      documentPolyfillUsage: getDocumentPolyfillUsageSnapshot(),
    });

    throw error;
  } finally {
    cleanup();
  }
};

const handleQueuedTask = async (data: WorkerRequest | null) => {
  flushPendingSuccessResponses();
  let isQueuedRender = false;
  let id = "";

  try {
    if (!data) return;
    const type = data.type;
    id = data.id;
    isQueuedRender = type === "render" || type === "renderImage";

    if (isQueuedRender) {
      isProcessing = true;
    }

    let result: TaskResult | undefined;

    switch (type) {
      case "render":
        result = await renderToCanvas(data);
        break;
      case "renderImage":
        result = await renderToImage(data);
        break;
      case "getTextContent":
        result = await getTextContentForPage(data);
        break;
      case "load": {
        const resolvedDocId = getDocId(data.docId);
        for (const rid of cancelQueuedTasksForDoc(resolvedDocId)) {
          postSuccess(rid, false);
        }
        cancelActiveTasksForDoc(resolvedDocId);
        await loadDocument(resolvedDocId, data.data, data.password);
        result = { payload: true };
        break;
      }
      case "unload": {
        const resolvedDocId = getDocId(data.docId);
        for (const rid of cancelQueuedTasksForDoc(resolvedDocId)) {
          postSuccess(rid, false);
        }
        cancelActiveTasksForDoc(resolvedDocId);
        await disposeDocument(resolvedDocId);
        result = { payload: true };
        break;
      }
      case "releaseCanvas": {
        const idsToRelease = new Set<string>(data.canvasIds);

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

        result = { payload: true };
        break;
      }
      case "cancelQueuedRenders": {
        const incomingScale = data.scale;
        const incomingDocId = getDocId(data.docId);
        const incomingPageIndex = data.pageIndex;

        if (
          incomingScale !== undefined &&
          incomingPageIndex !== undefined &&
          taskQueue.length > 0
        ) {
          for (let i = taskQueue.length - 1; i >= 0; i--) {
            const queued = taskQueue[i];
            if (queued.data.type !== "render") continue;

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

        result = { payload: true };
        break;
      }
      case "reprioritize": {
        const incomingDocId = getDocId(data.docId);
        const incomingPageIndex = data.pageIndex;
        const incomingScale = data.scale;
        const vc = data.viewportCenter;

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
        }

        result = { payload: true };
        break;
      }
      default:
        throw new Error("Unknown message type");
    }

    postSuccess(id, result?.payload, result?.transfer);
  } catch (err) {
    if (id) {
      postError(id, err?.message || "Unknown error");
    }
  } finally {
    if (isQueuedRender) {
      isProcessing = false;
    }
    flushPendingSuccessResponses();
    scheduleNext();
  }
};

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const data = e.data;
  const { type, id } = data;

  switch (type) {
    case "cancel": {
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

    // Optimization: When scale changes, discard all pending tasks with different scale
    // This ensures we don't waste time on tiles that are no longer needed
    case "cancelQueuedRenders":
    case "getTextContent":
    case "load":
    case "unload":
    case "releaseCanvas":
    case "reprioritize":
      void handleQueuedTask(data);
      return;

    case "render":
    case "renderImage": {
      // Early registration of canvas to prevent loss during cancellation or optimization
      if (type === "render" && data.canvas) {
        canvasMap.set(data.canvasId, data.canvas);
      }

      const priority = data.priority ?? 0;

      const queuedData = data;
      const incomingKey = buildQueueTaskKey(queuedData);
      const existingIndex = taskQueue.findIndex((item) => {
        const d = item.data;
        if (d.type !== "render" && d.type !== "renderImage") return false;
        return buildQueueTaskKey(d) === incomingKey;
      });
      if (existingIndex > -1) {
        const removed = taskQueue.splice(existingIndex, 1)[0];
        if (removed) {
          queueSuccessResponse(removed.id, false);
          void handleQueuedTask(null);
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
      return;
    }

    default:
      return;
  }
};
