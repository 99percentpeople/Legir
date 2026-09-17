import { DEFAULT_EDITOR_UI_STATE } from "@/constants";
import { canPerformPdfPermissionOperation } from "@/lib/pdfPermissions";
import type { EditorState, EditorUiState } from "@/types";
import type { EditorActions, EditorStoreSlice } from "@/store/store.types";

const hasSelectedControl = (state: EditorState) =>
  !!state.selectedId &&
  (state.fields.some((field) => field.id === state.selectedId) ||
    state.annotations.some((annotation) => annotation.id === state.selectedId));

// Returning the original state is important: an empty/same-value patch would
// still notify ordinary Zustand subscribers.
const changedUiPatch = (state: EditorState, patch: Partial<EditorUiState>) =>
  Object.entries(patch).every(([key, value]) =>
    Object.is(state[key as keyof EditorUiState], value),
  )
    ? state
    : patch;

// UI slice is limited to persisted UI panel/dialog state, distinct from
// document mutations and ephemeral runtime coordination.
export const createUiSlice: EditorStoreSlice<
  Pick<
    EditorActions,
    | "setUiState"
    | "resetUiState"
    | "openSidebar"
    | "closeSidebar"
    | "toggleSidebar"
    | "openRightPanel"
    | "closeRightPanel"
    | "toggleRightPanel"
    | "closeFloatingPanels"
    | "setPanelFloating"
    | "syncPanelSelection"
  >
> = (set, get) => ({
  setUiState: (updates) =>
    set((state) => {
      const nextValues =
        typeof updates === "function" ? updates(state) : updates;
      return changedUiPatch(state, nextValues);
    }),

  resetUiState: () => set({ ...DEFAULT_EDITOR_UI_STATE }),

  openSidebar: (tab) =>
    set((state) =>
      changedUiPatch(state, {
        isSidebarOpen: true,
        ...(tab === undefined ? {} : { sidebarTab: tab }),
        ...(state.isPanelFloating ? { isRightPanelOpen: false } : {}),
      }),
    ),

  closeSidebar: () =>
    set((state) => changedUiPatch(state, { isSidebarOpen: false })),

  toggleSidebar: () => {
    if (get().isSidebarOpen) get().closeSidebar();
    else get().openSidebar();
  },

  openRightPanel: (tab) =>
    set((state) => {
      const hasSelection = hasSelectedControl(state);
      if (tab === "properties" && !hasSelection) return state;
      const nextTab = tab ?? state.rightPanelTab;
      if (
        nextTab === "page_translate" &&
        (!canPerformPdfPermissionOperation(
          "extract_text",
          state.documentPermissions,
        ) ||
          !canPerformPdfPermissionOperation(
            "create_annotation",
            state.documentPermissions,
          ))
      ) {
        return state;
      }
      return changedUiPatch(state, {
        rightPanelTab:
          nextTab === "properties" && !hasSelection ? "document" : nextTab,
        isRightPanelOpen: true,
        ...(state.isPanelFloating ? { isSidebarOpen: false } : {}),
      });
    }),

  closeRightPanel: () =>
    set((state) => changedUiPatch(state, { isRightPanelOpen: false })),

  toggleRightPanel: () => {
    if (get().isRightPanelOpen) get().closeRightPanel();
    else get().openRightPanel();
  },

  closeFloatingPanels: () =>
    set((state) =>
      state.isPanelFloating
        ? changedUiPatch(state, {
            isSidebarOpen: false,
            isRightPanelOpen: false,
          })
        : state,
    ),

  setPanelFloating: (isPanelFloating) =>
    set((state) => {
      const closeRight =
        isPanelFloating && state.isSidebarOpen && state.isRightPanelOpen;
      if (state.isPanelFloating === isPanelFloating && !closeRight)
        return state;
      return {
        isPanelFloating,
        ...(closeRight ? { isRightPanelOpen: false } : {}),
      };
    }),

  // Selection can also change through document actions, undo, or tab restore.
  // The shell reports the transition; this slice owns its panel-tab policy.
  syncPanelSelection: (previousSelectedId) =>
    set((state) => {
      if (!previousSelectedId && hasSelectedControl(state)) {
        return changedUiPatch(state, { rightPanelTab: "properties" });
      }
      if (!hasSelectedControl(state) && state.rightPanelTab === "properties") {
        return { rightPanelTab: "document" };
      }
      return state;
    }),
});
