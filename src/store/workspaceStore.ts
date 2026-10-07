import { useContext } from "react";
import { EditorViewContext } from "./editorViewContext";
import type { EditorView } from "./editorView";
import { createStore, useStore } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  EditorState,
  EditorUiViewState,
  PageFlowDirection,
  PageLayoutMode,
} from "@/types";
import type { SidebarTab, RightPanelTab } from "@/types";
import type { EditorWindowLayout } from "@/app/editorTabs/types";
import { initialState } from "./helpers";

export type WorkspaceDialog = { type: "settings" | "shortcuts" };
export interface WorkspaceLayout {
  sidebar: { open: boolean; tab: SidebarTab; width: number };
  rightPanel: { open: boolean; tab: RightPanelTab; width: number };
  pageLayout: PageLayoutMode;
  pageFlow: PageFlowDirection;
}
export interface WorkspaceState {
  layout: WorkspaceLayout;
  tabsByWindow: Record<string, EditorWindowLayout>;
  dialog: WorkspaceDialog | null;
  isPanelFloating: boolean;
  isFullscreen: boolean;
}

const createInitialWorkspace = (): WorkspaceState => ({
  layout: {
    sidebar: {
      open: initialState.isSidebarOpen,
      tab: "thumbnails",
      width: initialState.sidebarWidth,
    },
    rightPanel: {
      open: initialState.isRightPanelOpen,
      tab: "document",
      width: initialState.rightPanelWidth,
    },
    pageLayout: initialState.pageLayout,
    pageFlow: initialState.pageFlow,
  },
  tabsByWindow: {},
  dialog: null,
  isPanelFloating: false,
  isFullscreen: false,
});

export const createWorkspaceStore = (persistent = true) => {
  if (!persistent) return createStore<WorkspaceState>(createInitialWorkspace);
  return createStore<WorkspaceState>()(
    persist(createInitialWorkspace, {
      name: "legir.workspace-layout",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ layout: state.layout }),
      merge: (saved, current) => {
        const layout = (saved as Partial<WorkspaceState> | null)?.layout;
        if (!layout || !layout.sidebar || !layout.rightPanel) return current;
        const sidebar = layout.sidebar;
        const right = layout.rightPanel;
        return {
          ...current,
          layout: {
            sidebar: {
              open:
                typeof sidebar.open === "boolean"
                  ? sidebar.open
                  : current.layout.sidebar.open,
              tab: (
                ["thumbnails", "outline", "fields", "annotations"] as const
              ).includes(sidebar.tab)
                ? sidebar.tab
                : "thumbnails",
              width:
                Number.isFinite(sidebar.width) && sidebar.width > 0
                  ? sidebar.width
                  : current.layout.sidebar.width,
            },
            rightPanel: {
              open:
                typeof right.open === "boolean"
                  ? right.open
                  : current.layout.rightPanel.open,
              tab: (
                ["document", "properties", "ai_chat", "page_translate"] as const
              ).includes(right.tab)
                ? right.tab
                : "document",
              width:
                Number.isFinite(right.width) && right.width > 0
                  ? right.width
                  : current.layout.rightPanel.width,
            },
            pageLayout: (
              ["single", "double_even", "double_odd"] as const
            ).includes(layout.pageLayout)
              ? layout.pageLayout
              : "single",
            pageFlow:
              layout.pageFlow === "horizontal" ? "horizontal" : "vertical",
          },
        };
      },
    }),
  );
};
export const workspaceStore = createWorkspaceStore();
export const useWorkspaceStore = <T>(
  selector: (state: WorkspaceState) => T,
) => {
  const context = useContext(EditorViewContext);
  const owner =
    context && "workspace" in context
      ? (context as EditorView).workspace
      : workspaceStore;
  return useStore(owner, selector);
};

// A flat render projection keeps canvas and panel contracts focused without
// putting a second writable copy of layout into document state.
export const readWorkspaceUi = (state: WorkspaceState): EditorUiViewState => ({
  isSidebarOpen: state.layout.sidebar.open,
  sidebarTab: state.layout.sidebar.tab,
  sidebarWidth: state.layout.sidebar.width,
  isRightPanelOpen: state.layout.rightPanel.open,
  rightPanelTab: state.layout.rightPanel.tab,
  rightPanelWidth: state.layout.rightPanel.width,
  pageLayout: state.layout.pageLayout,
  pageFlow: state.layout.pageFlow,
  isPanelFloating: state.isPanelFloating,
  isFullscreen: state.isFullscreen,
  activeDialog: state.dialog?.type ?? null,
});

export function patchWorkspaceUi(
  state: WorkspaceState,
  patch: Partial<EditorState>,
): Partial<WorkspaceState> {
  const ui = readWorkspaceUi(state);
  const next = { ...ui, ...patch };
  const result: Partial<WorkspaceState> = {};
  if (
    next.isSidebarOpen !== ui.isSidebarOpen ||
    next.sidebarTab !== ui.sidebarTab ||
    next.sidebarWidth !== ui.sidebarWidth ||
    next.isRightPanelOpen !== ui.isRightPanelOpen ||
    next.rightPanelTab !== ui.rightPanelTab ||
    next.rightPanelWidth !== ui.rightPanelWidth ||
    next.pageLayout !== ui.pageLayout ||
    next.pageFlow !== ui.pageFlow
  ) {
    result.layout = {
      sidebar: {
        open: next.isSidebarOpen,
        tab: next.sidebarTab as SidebarTab,
        width: next.sidebarWidth,
      },
      rightPanel: {
        open: next.isRightPanelOpen,
        tab: next.rightPanelTab as RightPanelTab,
        width: next.rightPanelWidth,
      },
      pageLayout: next.pageLayout,
      pageFlow: next.pageFlow,
    };
  }
  if (next.isPanelFloating !== ui.isPanelFloating)
    result.isPanelFloating = next.isPanelFloating;
  if (next.isFullscreen !== ui.isFullscreen)
    result.isFullscreen = next.isFullscreen;
  if (next.activeDialog !== ui.activeDialog) {
    result.dialog =
      next.activeDialog === null ? null : { type: next.activeDialog };
  }

  return result;
}
