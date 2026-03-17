import { useSyncExternalStore } from "react";

export type PDFPageRenderTiming = {
  kind: "initial" | "zoom" | null;
  sessionId: number | null;
  startedAt: number | null;
  targetScale: number | null;
  canvasReadyMs: number | null;
  textReadyMs: number | null;
};

export type PDFPageReadyState = {
  targetScale: number | null;
  canvasReady: boolean | null;
  textReady: boolean | null;
};

type LayerKind = "canvas" | "text";

type LayerState = {
  scale: number | null;
  ready: boolean | null;
};

type InternalPageState = {
  observedScale: number | null;
  previousVisibleScale: number | null;
  renderTiming: PDFPageRenderTiming | null;
  sessionSeq: number;
  layerStates: Record<LayerKind, LayerState>;
  snapshot: PDFPageRenderDebugSnapshot;
};

export type PDFPageRenderDebugSnapshot = {
  renderTiming: PDFPageRenderTiming | null;
  currentReadyState: PDFPageReadyState | null;
};

const pageStates = new Map<number, InternalPageState>();
const listenersByPage = new Map<number, Set<() => void>>();
const connectedPages = new Map<number, number>();
const EMPTY_SNAPSHOT: PDFPageRenderDebugSnapshot = {
  renderTiming: null,
  currentReadyState: null,
};

const createEmptyRenderTiming = (): PDFPageRenderTiming => ({
  kind: null,
  sessionId: null,
  startedAt: null,
  targetScale: null,
  canvasReadyMs: null,
  textReadyMs: null,
});

const createInitialPageState = (): InternalPageState => ({
  observedScale: null,
  previousVisibleScale: null,
  renderTiming: null,
  sessionSeq: 0,
  layerStates: {
    canvas: { scale: null, ready: null },
    text: { scale: null, ready: null },
  },
  snapshot: EMPTY_SNAPSHOT,
});

const getOrCreatePageState = (pageIndex: number) => {
  let state = pageStates.get(pageIndex);
  if (!state) {
    state = createInitialPageState();
    pageStates.set(pageIndex, state);
  }
  return state;
};

const getPageState = (pageIndex: number) => pageStates.get(pageIndex) ?? null;
const isPageConnected = (pageIndex: number) => connectedPages.has(pageIndex);

const emitPageUpdate = (pageIndex: number) => {
  listenersByPage.get(pageIndex)?.forEach((listener) => listener());
};

const createRenderSession = (
  state: InternalPageState,
  kind: "initial" | "zoom",
  scale: number,
) => {
  const sessionId = state.sessionSeq + 1;
  state.sessionSeq = sessionId;
  state.renderTiming = {
    kind,
    sessionId,
    startedAt: performance.now(),
    targetScale: scale,
    canvasReadyMs: null,
    textReadyMs: null,
  };
};

const updateSnapshot = (state: InternalPageState) => {
  const targetScale = state.observedScale;
  const currentReadyState =
    targetScale === null
      ? null
      : {
          targetScale,
          canvasReady:
            state.layerStates.canvas.scale === targetScale
              ? state.layerStates.canvas.ready
              : null,
          textReady:
            state.layerStates.text.scale === targetScale
              ? state.layerStates.text.ready
              : null,
        };

  state.snapshot = {
    renderTiming: state.renderTiming,
    currentReadyState,
  };
};

const getSnapshotForPage = (pageIndex: number): PDFPageRenderDebugSnapshot => {
  const state = getPageState(pageIndex);
  if (!state) {
    return EMPTY_SNAPSHOT;
  }
  return state.snapshot;
};

export const connectPDFPageRenderDebug = (pageIndex: number) => {
  connectedPages.set(pageIndex, (connectedPages.get(pageIndex) ?? 0) + 1);
  const state = getOrCreatePageState(pageIndex);
  updateSnapshot(state);

  return () => {
    const currentCount = connectedPages.get(pageIndex) ?? 0;
    if (currentCount <= 1) {
      connectedPages.delete(pageIndex);
      pageStates.delete(pageIndex);
      listenersByPage.delete(pageIndex);
      return;
    }
    connectedPages.set(pageIndex, currentCount - 1);
  };
};

export const syncPDFPageRenderDebugView = (opts: {
  pageIndex: number;
  scale: number;
  isInView: boolean;
  debugJustEnabled: boolean;
}) => {
  const { pageIndex, scale, isInView, debugJustEnabled } = opts;
  if (!isPageConnected(pageIndex)) {
    return;
  }
  const state = getOrCreatePageState(pageIndex);

  if (!isInView) {
    state.observedScale = null;
    state.renderTiming = null;
    updateSnapshot(state);
    emitPageUpdate(pageIndex);
    return;
  }

  state.observedScale = scale;

  if (debugJustEnabled) {
    state.previousVisibleScale = scale;
    state.renderTiming = createEmptyRenderTiming();
    updateSnapshot(state);
    emitPageUpdate(pageIndex);
    return;
  }

  if (state.previousVisibleScale === null) {
    state.previousVisibleScale = scale;
    createRenderSession(state, "initial", scale);
    updateSnapshot(state);
    emitPageUpdate(pageIndex);
    return;
  }

  const previousScale = state.previousVisibleScale;
  state.previousVisibleScale = scale;

  if (previousScale === scale) {
    state.renderTiming = createEmptyRenderTiming();
    updateSnapshot(state);
    emitPageUpdate(pageIndex);
    return;
  }

  createRenderSession(state, "zoom", scale);
  updateSnapshot(state);
  emitPageUpdate(pageIndex);
};

export const reportPDFPageRenderLayerReady = (opts: {
  pageIndex: number;
  layer: LayerKind;
  scale: number;
  completedAt: number;
}) => {
  const { pageIndex, layer, scale, completedAt } = opts;
  if (!isPageConnected(pageIndex)) {
    return;
  }
  const state = getPageState(pageIndex);
  if (!state) {
    return;
  }
  const timing = state.renderTiming;
  if (
    !timing ||
    timing.startedAt === null ||
    timing.targetScale === null ||
    timing.targetScale !== scale
  ) {
    return;
  }

  const readyMs = Math.max(0, Math.round(completedAt - timing.startedAt));
  if (layer === "canvas") {
    if (timing.canvasReadyMs !== null) return;
    timing.canvasReadyMs = readyMs;
  } else {
    if (timing.textReadyMs !== null) return;
    timing.textReadyMs = readyMs;
  }

  updateSnapshot(state);
  emitPageUpdate(pageIndex);
};

export const reportPDFPageRenderLayerState = (opts: {
  pageIndex: number;
  layer: LayerKind;
  scale: number;
  ready: boolean;
}) => {
  const { pageIndex, layer, scale, ready } = opts;
  if (!isPageConnected(pageIndex)) {
    return;
  }
  const state = getPageState(pageIndex);
  if (!state) {
    return;
  }
  const current = state.layerStates[layer];

  if (current.scale === scale && current.ready === ready) {
    return;
  }

  state.layerStates[layer] = {
    scale,
    ready,
  };

  updateSnapshot(state);
  emitPageUpdate(pageIndex);
};

const subscribeToPage = (pageIndex: number, listener: () => void) => {
  let listeners = listenersByPage.get(pageIndex);
  if (!listeners) {
    listeners = new Set();
    listenersByPage.set(pageIndex, listeners);
  }
  listeners.add(listener);

  return () => {
    const current = listenersByPage.get(pageIndex);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listenersByPage.delete(pageIndex);
    }
  };
};

export const usePDFPageRenderDebugSnapshot = (pageIndex: number) =>
  useSyncExternalStore(
    (listener) => subscribeToPage(pageIndex, listener),
    () => getSnapshotForPage(pageIndex),
    () => getSnapshotForPage(pageIndex),
  );
