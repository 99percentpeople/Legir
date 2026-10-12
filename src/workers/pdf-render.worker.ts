/// <reference lib="webworker" />
import type { PDFDocument } from "@legir/pdfium";
import type {
  WorkerErrorResponse,
  WorkerProgressResponse,
  WorkerRequest,
  WorkerSuccessResponse,
} from "@/services/pdfService/workerProtocol";
import { getPDFium } from "@/services/pdfService/engine/runtime";
import {
  getNativePageViewport,
  getNativeTextContent,
  resolveNativeDestination,
} from "@/services/pdfService/engine/pageContent";
import {
  drawPageToCanvas,
  disposeNativePage,
} from "@/services/pdfService/engine/raster";
import { getThumbnailSourceAnnotations } from "@/services/pdfService/lib/thumbnailSourceAnnotations";

import { DocumentSession } from "@/services/pdfService/engine/documentSession";
import { NativePageCache } from "@/services/pdfService/engine/pageCache";
import { getEditingView } from "@/services/pdfService/engine/editingDocument";
import {
  setWorkerFontProvider,
  type FontHostResponse,
} from "@/services/pdfService/engine/fontHost";

let fontSequence = 0;
const fontRequests = new Map<string, (bytes?: Uint8Array) => void>();
setWorkerFontProvider(
  (request) =>
    new Promise((resolve) => {
      const id = `font_${fontSequence++}`;
      fontRequests.set(id, resolve);
      self.postMessage({ type: "fontRequest", id, request });
    }),
);

let session: DocumentSession | null = null;
const waitingCommands = new Map<string, { cancelled: boolean }>();
let exclusiveTail: Promise<void> = Promise.resolve();
const exclusive = (run: () => Promise<void>) => {
  const next = exclusiveTail.then(run, run);
  exclusiveTail = next.catch(() => {});
  return next;
};

type DocState = {
  pdfDoc: PDFDocument | null;
  loading: Promise<void> | null;
  generation: number;
  pageCache: NativePageCache;
};
const docs = new Map<string, DocState>();
const getDocId = (docId?: string) => docId || "default";
const getDocState = (docId: string): DocState => {
  let state = docs.get(docId);
  if (!state) {
    state = {
      pdfDoc: null,
      loading: null,
      generation: 0,
      pageCache: new NativePageCache((index) =>
        session!.loadPage(docId, index),
      ),
    };
    docs.set(docId, state);
  }
  return state;
};
const canvasMap = new Map<string, OffscreenCanvas>();

// Store active render tasks to allow cancellation
const activeRenderTasks = new Map<
  string,
  { cancel: () => void; docId: string; canvasId?: string }
>();

const registerCancellableTask = (
  id: string,
  docId: string,
  onCancel?: () => void,
  meta?: {
    canvasId?: string;
  },
) => {
  let isCancelled = false;
  activeRenderTasks.set(id, {
    docId,
    canvasId: meta?.canvasId,
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
      throw new DOMException("Rendering cancelled", "AbortError");
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
const compareRenderTasks = (a: QueueItem, b: QueueItem) =>
  Number(a.data.type === "renderImage") -
    Number(b.data.type === "renderImage") || a.priority - b.priority;
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
  // Live snapshots must never deduplicate against another revision/copy.
  if (req.type === "renderImage" && req.thumbnailContent) return req.id;
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

const postProgress = (
  id: string,
  payload: { docId?: string; loaded: number; total?: number },
) => {
  const msg: WorkerProgressResponse = {
    type: "loadProgress",
    id,
    docId: payload.docId,
    loaded: payload.loaded,
    total: payload.total,
  };
  self.postMessage(msg);
};

// Process the next task in the queue
const processQueue = async () => {
  if (isProcessing || taskQueue.length === 0) return;
  isProcessing = true;
  await exclusive(async () => {
    // A parse/export can hold the document while new reader work arrives.
    // Choose at execution time so an earlier preview cannot jump the queue.
    const item = taskQueue.shift();
    if (item) await handleQueuedTask(item.data);
    else {
      isProcessing = false;
      scheduleNext();
    }
  });
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

const disposeState = (state: DocState) => {
  state.pageCache.clear();
  state.pdfDoc = null;
};

const loadDocument = async (
  docId: string,
  bytes: Uint8Array,
  password?: string,
  progressId?: string,
) => {
  const state = getDocState(docId);
  const previous = state.loading;
  const generation = ++state.generation;
  const pending = (async () => {
    await previous?.catch(() => {});
    const pdfium = await getPDFium();
    if (state.generation !== generation || docs.get(docId) !== state) return;
    disposeState(state);
    if (!session || docId === session.primaryId) {
      for (const current of docs.values()) disposeState(current);
      session?.dispose();
      session = null;
      docs.clear();
      docs.set(docId, state);
      session = new DocumentSession(pdfium, bytes, password, docId);
    } else await session.addSource(docId, bytes, password);
    state.pdfDoc = session.document;
    if (progressId)
      postProgress(progressId, {
        docId,
        loaded: bytes.length,
        total: bytes.length,
      });
  })();
  state.loading = pending;
  try {
    await pending;
  } finally {
    if (state.loading === pending) state.loading = null;
  }
};

const disposeDocument = async (docId: string) => {
  const state = docs.get(docId);
  if (!state) return;
  docs.delete(docId);
  await state.loading?.catch(() => {});
  disposeState(state);
  if (session?.primaryId === docId) {
    for (const current of docs.values()) disposeState(current);
    docs.clear();
    session.dispose();
    session = null;
  } else if (session) {
    for (const current of docs.values()) {
      disposeState(current);
      current.pdfDoc = session.document;
    }
    session.removeSource(docId);
  }
};

const ensureDocumentLoaded = async (
  docId: string,
  options?: { isNewDoc?: boolean; data?: Uint8Array | null; password?: string },
) => {
  if (options?.isNewDoc && options.data)
    await loadDocument(docId, options.data, options.password);
  const state = getDocState(docId);
  await state.loading;
  if (!state.pdfDoc) throw new Error("PDF Document not loaded");
  return state.pdfDoc;
};

const getPageForDoc = (
  docId: string,
  pageIndex: number,
  foreground = false,
) => {
  const state = getDocState(docId);
  if (!state.pdfDoc) throw new Error("PDF Document not loaded");
  return { page: state.pageCache.get(pageIndex, foreground) };
};

const readFromDocument = async (
  params: WorkerRequest,
  read: (doc: PDFDocument) => unknown,
): Promise<TaskResult> => {
  const docId = getDocId("docId" in params ? params.docId : undefined);
  const task = registerCancellableTask(params.id, docId);
  try {
    const doc = await ensureDocumentLoaded(docId);
    task.throwIfCancelled();
    return { payload: read(doc) };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      return { payload: false };
    throw error;
  } finally {
    task.cleanup();
  }
};
const getTextContentForPage = async (
  params: Extract<WorkerRequest, { type: "getTextContent" }>,
) => {
  const pdfium = await getPDFium();
  return readFromDocument(params, () =>
    getNativeTextContent(
      pdfium,
      getPageForDoc(getDocId(params.docId), params.pageIndex).page,
      params.pageIndex,
    ),
  );
};
const getOutlineForDoc = (params: WorkerRequest) =>
  readFromDocument(
    params,
    () =>
      session!.getSource(getDocId("docId" in params ? params.docId : undefined))
        .outline,
  );
const getPermissionsForDoc = (params: WorkerRequest) =>
  readFromDocument(
    params,
    () =>
      session!.getSource(getDocId("docId" in params ? params.docId : undefined))
        .permissions,
  );
const resolveDestForDoc = (
  params: Extract<WorkerRequest, { type: "resolveDest" }>,
) =>
  readFromDocument(params, (doc) => resolveNativeDestination(doc, params.dest));

const renderToCanvas = async (
  params: Extract<WorkerRequest, { type: "render" }>,
): Promise<TaskResult> => {
  const docId = getDocId(params.docId);
  const task = registerCancellableTask(params.id, docId, undefined, {
    canvasId: params.canvasId,
  });
  try {
    await ensureDocumentLoaded(docId);
    const pdfium = await getPDFium();
    task.throwIfCancelled();
    const canvas = params.canvas ?? canvasMap.get(params.canvasId);
    if (!canvas) throw new Error("Missing render canvas");
    const cached = getPageForDoc(docId, params.pageIndex, true);
    const viewport = getNativePageViewport(
      cached.page,
      params.scale,
      params.rotation,
    );
    const [x, y, width, height] = params.tile ?? [
      0,
      0,
      Math.max(1, Math.floor(viewport.width)),
      Math.max(1, Math.floor(viewport.height)),
    ];
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not get canvas context");
    drawPageToCanvas(
      pdfium,
      cached.page,
      viewport,
      [x, y, x + width, y + height],
      ctx,
      { annotations: params.renderAnnotations === true },
    );
    task.throwIfCancelled();
    // Acknowledge after the transferred canvas can be presented.
    await new Promise<void>((resolve) =>
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(() => resolve())
        : setTimeout(resolve, 0),
    );
    task.throwIfCancelled();
    return { payload: true };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      return { payload: false };
    throw error;
  } finally {
    task.cleanup();
  }
};

const renderToImage = async (
  params: Extract<WorkerRequest, { type: "renderImage" }>,
): Promise<TaskResult> => {
  const docId = getDocId(params.docId);
  const task = registerCancellableTask(params.id, docId);
  try {
    await ensureDocumentLoaded(docId, params.isNewDoc ? params : undefined);
    const pdfium = await getPDFium();
    task.throwIfCancelled();
    const cached = getPageForDoc(docId, params.pageIndex);
    const base = getNativePageViewport(cached.page);
    const scale =
      params.scale ??
      (params.targetWidth
        ? Math.min(1, Math.max(0.05, params.targetWidth / base.width))
        : 1);
    const viewport = getNativePageViewport(cached.page, scale);
    const width = Math.max(1, Math.floor(viewport.width)),
      height = Math.max(1, Math.floor(viewport.height));
    const content = params.thumbnailContent;
    const keepAnnotations = content
      ? new Set(
          [...getThumbnailSourceAnnotations(content)].map(
            (ref) => session!.getSource(docId).refs?.get(ref) ?? ref,
          ),
        )
      : undefined;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not get canvas context");
    drawPageToCanvas(
      pdfium,
      cached.page,
      viewport,
      [0, 0, width, height],
      ctx,
      {
        annotations: !content && params.renderAnnotations === true,
        keepAnnotations,
        imageCache: "reuse",
      },
    );
    if (content) {
      const { drawThumbnailOverlay } =
        await import("@/services/pdfService/lib/thumbnailOverlay");
      await session!.transaction(
        session!.primaryId,
        async (view) => {
          const index = await drawThumbnailOverlay(view, content);
          task.throwIfCancelled();
          if (index === null) return;
          await getEditingView(view)!.flush();
          session!.document.setPageTreeCache(false);
          const page = session!.document.loadPage(index);
          const overlayCanvas = new OffscreenCanvas(width, height);
          try {
            drawPageToCanvas(
              pdfium,
              page,
              getNativePageViewport(page, scale),
              [0, 0, width, height],
              overlayCanvas.getContext("2d")!,
              { annotations: true, transparent: true, imageCache: "reuse" },
            );
            ctx.drawImage(overlayCanvas, 0, 0);
          } finally {
            overlayCanvas.width = overlayCanvas.height = 0;
            disposeNativePage(page);
          }
        },
        true,
      );
    }

    task.throwIfCancelled();
    const blob = await canvas.convertToBlob({
      type: params.mimeType ?? "image/jpeg",
      quality: params.quality ?? 0.8,
    });
    const imageBytes = await blob.arrayBuffer();
    task.throwIfCancelled();
    return {
      payload: { mimeType: blob.type, imageBytes },
      transfer: [imageBytes],
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      return { payload: false };
    throw error;
  } finally {
    task.cleanup();
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
      case "getOutline":
        result = await getOutlineForDoc(data);
        break;
      case "getPermissions":
        result = await getPermissionsForDoc(data);
        break;
      case "resolveDest":
        result = await resolveDestForDoc(data);
        break;
      case "load": {
        const resolvedDocId = getDocId(data.docId);
        for (const rid of cancelQueuedTasksForDoc(resolvedDocId)) {
          postSuccess(rid, false);
        }
        cancelActiveTasksForDoc(resolvedDocId);
        await loadDocument(resolvedDocId, data.data, data.password, data.id);
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
          for (const [taskId, task] of Array.from(
            activeRenderTasks.entries(),
          )) {
            if (!task.canvasId || !idsToRelease.has(task.canvasId)) continue;
            try {
              task.cancel();
            } catch {
              // ignore
            }
            activeRenderTasks.delete(taskId);
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

          taskQueue.sort(compareRenderTasks);
        }

        result = { payload: true };
        break;
      }
      case "addBlankSource": {
        await ensureDocumentLoaded("default");
        session!.addBlankSource(data.docId, data.width, data.height);
        getDocState(data.docId).pdfDoc = session!.document;
        result = { payload: true };
        break;
      }
      case "contentOperation": {
        await ensureDocumentLoaded("default");
        const payload = await session!.content(data.request);
        result = { payload };
        break;
      }
      case "inspectDocument":
      case "parseDocument":
      case "exportDocument":
      case "documentStats": {
        await ensureDocumentLoaded("default");
        const controller = new AbortController();
        const task = registerCancellableTask(id, "default", () =>
          controller.abort(),
        );
        try {
          if (data.type === "inspectDocument")
            result = { payload: await session!.inspect() };
          else if (data.type === "documentStats")
            result = { payload: session!.stats() };
          else if (data.type === "parseDocument") {
            const payload = await session!.parse(
              data,
              async (index) => {
                const pdfium = await getPDFium();
                const page = session!.document.loadPage(index);
                try {
                  const viewport = getNativePageViewport(page, 2);
                  const width = Math.max(1, Math.floor(viewport.width)),
                    height = Math.max(1, Math.floor(viewport.height));
                  const canvas = new OffscreenCanvas(width, height);
                  drawPageToCanvas(
                    pdfium,
                    page,
                    viewport,
                    [0, 0, width, height],
                    canvas.getContext("2d")!,
                    { contents: false, annotations: true },
                  );
                  const blob = await canvas.convertToBlob({
                    type: "image/png",
                  });
                  return {
                    bytes: new Uint8Array(await blob.arrayBuffer()),
                    mimeType: blob.type,
                  };
                } finally {
                  disposeNativePage(page);
                }
              },
              controller.signal,
            );
            result = {
              payload,
              transfer: payload.fonts.map(
                (font) => font.bytes.buffer as ArrayBuffer,
              ),
            };
          } else {
            const payload = await session!.export(data, controller.signal);
            for (const sourceId of session!.sources.keys())
              getDocState(sourceId).pdfDoc = session!.document;
            result = { payload, transfer: [payload.buffer as ArrayBuffer] };
          }
          task.throwIfCancelled();
        } finally {
          task.cleanup();
          // Read-only hydration retains the first page's parsed/decoded data.
          // A journaled write may affect shared resources: invalidate safely.
          if (
            data.type === "exportDocument" ||
            (data.type === "parseDocument" && session!.lastTransactionChanged)
          ) {
            for (const state of docs.values()) {
              state.pageCache.clear();
            }
          }
        }
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

self.onmessage = async (e: MessageEvent<WorkerRequest | FontHostResponse>) => {
  const data = e.data;
  if (data.type === "fontResponse") {
    fontRequests.get(data.id)?.(data.bytes);
    fontRequests.delete(data.id);
    return;
  }
  const { type, id } = data;

  switch (type) {
    case "cancel": {
      const waiting = waitingCommands.get(id);
      if (waiting) waiting.cancelled = true;
      // 1. Check if it's in the queue and remove it
      const queueIndex = taskQueue.findIndex((item) => item.id === id);
      if (queueIndex > -1) {
        taskQueue.splice(queueIndex, 1);
        // console.log(`Task ${id} removed from queue (cancelled)`);
        postSuccess(id, false);
      }

      // 2. Check if it's currently running and cancel it
      const task = activeRenderTasks.get(id);
      if (task) {
        task.cancel();
        activeRenderTasks.delete(id);
        postSuccess(id, false);
      }
      return;
    }

    // Optimization: When scale changes, discard all pending tasks with different scale
    // This ensures we don't waste time on tiles that are no longer needed
    case "cancelQueuedRenders":
    case "releaseCanvas":
    case "reprioritize":
      void handleQueuedTask(data);
      return;

    case "addBlankSource":
    case "contentOperation":
    case "inspectDocument":
    case "parseDocument":
    case "exportDocument":
    case "documentStats":
    case "getTextContent":
    case "getOutline":
    case "getPermissions":
    case "resolveDest":
    case "load":
    case "unload": {
      const pending = { cancelled: false };
      waitingCommands.set(id, pending);
      void exclusive(async () => {
        waitingCommands.delete(id);
        if (pending.cancelled) {
          postError(id, "Operation cancelled");
          return;
        }
        await handleQueuedTask(data);
      });
      return;
    }

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

      // Reader work wins even when tile distances exceed thumbnail priorities.
      taskQueue.sort(compareRenderTasks);

      // Trigger processing
      scheduleNext();
      return;
    }

    default:
      return;
  }
};
