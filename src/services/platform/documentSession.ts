import type { EditorTabSnapshot } from "@/app/editorTabs/types";

const STORAGE_KEY = "app-editor-ui-session";

export type PersistedEditorUiSession = {
  updatedAt: number;
  mode: EditorTabSnapshot["mode"];
  tool: EditorTabSnapshot["tool"];
  penStyle: EditorTabSnapshot["penStyle"];
  highlightStyle: EditorTabSnapshot["highlightStyle"];
  commentStyle: EditorTabSnapshot["commentStyle"];
  freetextStyle: EditorTabSnapshot["freetextStyle"];
  shapeStyle: EditorTabSnapshot["shapeStyle"];
  translateOption: EditorTabSnapshot["translateOption"];
  translateTargetLanguage: EditorTabSnapshot["translateTargetLanguage"];
  pageTranslateOptions: EditorTabSnapshot["pageTranslateOptions"];
  pageLayout: EditorTabSnapshot["pageLayout"];
  pageFlow: EditorTabSnapshot["pageFlow"];
  isSidebarOpen: EditorTabSnapshot["isSidebarOpen"];
  isRightPanelOpen: EditorTabSnapshot["isRightPanelOpen"];
  rightPanelTab: EditorTabSnapshot["rightPanelTab"];
  rightPanelDockTab: EditorTabSnapshot["rightPanelDockTab"];
  sidebarTab: EditorTabSnapshot["sidebarTab"];
  scale: EditorTabSnapshot["scale"];
  currentPageIndex: EditorTabSnapshot["currentPageIndex"];
  pendingViewStateRestore: EditorTabSnapshot["pendingViewStateRestore"];
  sidebarWidth: EditorTabSnapshot["sidebarWidth"];
  rightPanelWidth: EditorTabSnapshot["rightPanelWidth"];
};

const clonePersistedSession = (
  session: PersistedEditorUiSession,
): PersistedEditorUiSession => ({
  ...session,
  penStyle: { ...session.penStyle },
  highlightStyle: session.highlightStyle
    ? { ...session.highlightStyle }
    : undefined,
  commentStyle: session.commentStyle ? { ...session.commentStyle } : undefined,
  freetextStyle: session.freetextStyle
    ? { ...session.freetextStyle }
    : undefined,
  shapeStyle: session.shapeStyle ? { ...session.shapeStyle } : undefined,
  pageTranslateOptions: { ...session.pageTranslateOptions },
  rightPanelDockTab: [...session.rightPanelDockTab],
  pendingViewStateRestore: session.pendingViewStateRestore
    ? { ...session.pendingViewStateRestore }
    : null,
});

const createPersistedSessionFromSnapshot = (
  snapshot: EditorTabSnapshot,
): PersistedEditorUiSession => ({
  updatedAt: Date.now(),
  mode: snapshot.mode,
  tool: snapshot.tool,
  penStyle: { ...snapshot.penStyle },
  highlightStyle: snapshot.highlightStyle
    ? { ...snapshot.highlightStyle }
    : undefined,
  commentStyle: snapshot.commentStyle
    ? { ...snapshot.commentStyle }
    : undefined,
  freetextStyle: snapshot.freetextStyle
    ? { ...snapshot.freetextStyle }
    : undefined,
  shapeStyle: snapshot.shapeStyle ? { ...snapshot.shapeStyle } : undefined,
  translateOption: snapshot.translateOption,
  translateTargetLanguage: snapshot.translateTargetLanguage,
  pageTranslateOptions: { ...snapshot.pageTranslateOptions },
  pageLayout: snapshot.pageLayout,
  pageFlow: snapshot.pageFlow,
  isSidebarOpen: snapshot.isSidebarOpen,
  isRightPanelOpen: snapshot.isRightPanelOpen,
  rightPanelTab: snapshot.rightPanelTab,
  rightPanelDockTab: [...snapshot.rightPanelDockTab],
  sidebarTab: snapshot.sidebarTab,
  scale: snapshot.scale,
  currentPageIndex: snapshot.currentPageIndex,
  pendingViewStateRestore: snapshot.pendingViewStateRestore
    ? { ...snapshot.pendingViewStateRestore }
    : null,
  sidebarWidth: snapshot.sidebarWidth,
  rightPanelWidth: snapshot.rightPanelWidth,
});

const readSession = (): PersistedEditorUiSession | null => {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return clonePersistedSession(parsed as PersistedEditorUiSession);
  } catch {
    return null;
  }
};

const writeSession = (session: PersistedEditorUiSession | null) => {
  if (typeof window === "undefined") return;

  if (!session) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
};

export const saveGlobalEditorUiSession = (snapshot: EditorTabSnapshot) => {
  writeSession(createPersistedSessionFromSnapshot(snapshot));
};

export const getSavedGlobalEditorUiSession = () => {
  const session = readSession();
  return session ? clonePersistedSession(session) : null;
};

export const applyGlobalEditorUiSession = (
  snapshot: EditorTabSnapshot,
  session: PersistedEditorUiSession,
): EditorTabSnapshot => ({
  ...snapshot,
  mode: session.mode,
  tool: session.tool,
  penStyle: { ...session.penStyle },
  highlightStyle: session.highlightStyle
    ? { ...session.highlightStyle }
    : undefined,
  commentStyle: session.commentStyle ? { ...session.commentStyle } : undefined,
  freetextStyle: session.freetextStyle
    ? { ...session.freetextStyle }
    : undefined,
  shapeStyle: session.shapeStyle ? { ...session.shapeStyle } : undefined,
  translateOption: session.translateOption,
  translateTargetLanguage: session.translateTargetLanguage,
  pageTranslateOptions: { ...session.pageTranslateOptions },
  pageLayout: session.pageLayout,
  pageFlow: session.pageFlow,
  isSidebarOpen: session.isSidebarOpen,
  isRightPanelOpen: session.isRightPanelOpen,
  rightPanelTab: session.rightPanelTab,
  rightPanelDockTab: [...session.rightPanelDockTab],
  sidebarTab: session.sidebarTab,
  scale: session.scale,
  currentPageIndex: session.currentPageIndex,
  pendingViewStateRestore: session.pendingViewStateRestore
    ? { ...session.pendingViewStateRestore }
    : null,
  sidebarWidth: session.sidebarWidth,
  rightPanelWidth: session.rightPanelWidth,
});
