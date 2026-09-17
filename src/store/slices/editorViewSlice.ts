import { MAX_EDITOR_SCALE, MIN_EDITOR_SCALE } from "@/constants";
import {
  canUseModeWithPdfPermissions,
  canUseToolWithPdfPermissions,
} from "@/lib/pdfPermissions";
import type { EditorActions, EditorStoreSlice } from "@/store/store.types";

const clampEditorScale = (scale: number) =>
  Math.max(MIN_EDITOR_SCALE, Math.min(MAX_EDITOR_SCALE, scale));

const nextFitTrigger = (current: number) => Math.max(Date.now(), current + 1);

// Workspace view transitions live here so every toolbar, shortcut, and canvas
// entry point applies the same scale bounds, fit signal, and permission rules.
export const createEditorViewSlice: EditorStoreSlice<
  Pick<
    EditorActions,
    | "setScale"
    | "zoomBy"
    | "fitToScale"
    | "setPageLayout"
    | "setPageFlow"
    | "setEditorMode"
    | "setEditorFullscreen"
    | "beginTemporaryPan"
    | "endTemporaryPan"
  >
> = (set, get) => ({
  setScale: (scale) =>
    set((state) => {
      const nextScale = clampEditorScale(scale);
      return nextScale === state.scale ? state : { scale: nextScale };
    }),

  zoomBy: (factor) => {
    if (!Number.isFinite(factor) || factor <= 0) return;
    set((state) => {
      const scale = clampEditorScale(state.scale * factor);
      return scale === state.scale ? state : { scale };
    });
  },

  fitToScale: (scale) =>
    set((state) => ({
      scale: clampEditorScale(scale),
      fitTrigger: nextFitTrigger(state.fitTrigger),
    })),

  setPageLayout: (pageLayout) =>
    set((state) => ({
      pageLayout,
      fitTrigger: nextFitTrigger(state.fitTrigger),
    })),

  setPageFlow: (pageFlow) =>
    set((state) => ({
      pageFlow,
      fitTrigger: nextFitTrigger(state.fitTrigger),
    })),

  setEditorMode: (mode, defaultTool) =>
    set((state) => {
      if (
        state.documentLoadState !== undefined &&
        state.documentLoadState !== "ready"
      ) {
        return state.tool === "select_text" ? state : { tool: "select_text" };
      }
      if (!canUseModeWithPdfPermissions(mode, state.documentPermissions)) {
        return state.tool === "select" ? state : { tool: "select" };
      }

      if (state.mode === mode && state.tool === defaultTool) return state;
      return { mode, tool: defaultTool };
    }),

  setEditorFullscreen: (isFullscreen) =>
    set((state) =>
      state.isFullscreen === isFullscreen ? state : { isFullscreen },
    ),

  beginTemporaryPan: () => {
    const state = get();
    if (state.keys.space) return null;
    const previousTool = state.tool === "pan" ? null : state.tool;
    // Unlike persistent setTool('pan'), the temporary hand tool keeps selection.
    set({ tool: "pan", keys: { ...state.keys, space: true } });
    return previousTool;
  },

  endTemporaryPan: (previousTool) =>
    set((state) => {
      // Tab restoration resets transient keys; do not restore an old tab's tool.
      if (!state.keys.space) return state;
      let tool = state.tool;
      if (previousTool && tool === "pan") {
        tool =
          state.documentLoadState !== undefined &&
          state.documentLoadState !== "ready"
            ? "select_text"
            : canUseToolWithPdfPermissions(
                  previousTool,
                  state.mode,
                  state.documentPermissions,
                )
              ? previousTool
              : "select";
      }
      return { tool, keys: { ...state.keys, space: false } };
    }),
});
