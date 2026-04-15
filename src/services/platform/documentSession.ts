import type { EditorTabSnapshot } from "@/app/editorTabs/types";

const STORAGE_KEY = "app-editor-ui-session";

export type PersistedEditorUiSession = {
  updatedAt: number;
  sourceKey: string | null;
  mode: EditorTabSnapshot["mode"];
  tool: EditorTabSnapshot["tool"];
  penStyle: EditorTabSnapshot["penStyle"];
  highlightStyle: EditorTabSnapshot["highlightStyle"];
  commentStyle: EditorTabSnapshot["commentStyle"];
  freetextStyle: EditorTabSnapshot["freetextStyle"];
  shapeStyle: EditorTabSnapshot["shapeStyle"];
  stampStyle: EditorTabSnapshot["stampStyle"];
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

const getSnapshotSourceKey = (snapshot: EditorTabSnapshot) => {
  if (snapshot.saveTarget?.kind === "tauri") {
    return `tauri:${snapshot.saveTarget.path}`;
  }

  if (snapshot.saveTarget?.kind === "web") {
    const saveTargetId = snapshot.saveTarget.id?.trim();
    if (saveTargetId) {
      return `web-file:${saveTargetId}`;
    }

    const handleName = snapshot.saveTarget.handle?.name?.trim();
    return handleName ? `web-handle:${handleName}` : null;
  }

  const file = snapshot.pdfFile;
  if (file) {
    return `web-file:${file.name}:${file.size}:${file.lastModified}`;
  }

  return null;
};

const clonePersistedSession = (
  session: PersistedEditorUiSession,
): PersistedEditorUiSession => ({
  ...session,
  sourceKey: typeof session.sourceKey === "string" ? session.sourceKey : null,
  penStyle: { ...session.penStyle },
  highlightStyle: session.highlightStyle
    ? { ...session.highlightStyle }
    : undefined,
  commentStyle: session.commentStyle ? { ...session.commentStyle } : undefined,
  freetextStyle: session.freetextStyle
    ? { ...session.freetextStyle }
    : undefined,
  shapeStyle: session.shapeStyle ? { ...session.shapeStyle } : undefined,
  stampStyle: session.stampStyle ? { ...session.stampStyle } : undefined,
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
  sourceKey: getSnapshotSourceKey(snapshot),
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
  stampStyle: snapshot.stampStyle ? { ...snapshot.stampStyle } : undefined,
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

export const resolveGlobalEditorUiSessionForDocument = (options: {
  sourceKey: string | null;
  pageCount: number;
}) => {
  const session = getSavedGlobalEditorUiSession();
  const restoreDocumentViewport =
    options.sourceKey !== null && session?.sourceKey === options.sourceKey;
  const pendingViewStateRestore =
    restoreDocumentViewport && session?.pendingViewStateRestore
      ? { ...session.pendingViewStateRestore }
      : null;
  const currentPageIndex =
    restoreDocumentViewport && typeof session?.currentPageIndex === "number"
      ? Math.max(
          0,
          Math.min(
            Math.max(0, options.pageCount - 1),
            Math.floor(session.currentPageIndex),
          ),
        )
      : 0;

  return {
    session,
    restoreDocumentViewport,
    currentPageIndex,
    pendingViewStateRestore,
  };
};

export const applyGlobalEditorUiSession = (
  snapshot: EditorTabSnapshot,
  session: PersistedEditorUiSession,
  options?: {
    restoreDocumentViewport?: boolean;
  },
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
  stampStyle: session.stampStyle ? { ...session.stampStyle } : undefined,
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
  scale:
    options?.restoreDocumentViewport === false ? snapshot.scale : session.scale,
  currentPageIndex:
    options?.restoreDocumentViewport === false
      ? snapshot.currentPageIndex
      : session.currentPageIndex,
  pendingViewStateRestore:
    options?.restoreDocumentViewport === false
      ? snapshot.pendingViewStateRestore
      : session.pendingViewStateRestore
        ? { ...session.pendingViewStateRestore }
        : null,
  sidebarWidth: session.sidebarWidth,
  rightPanelWidth: session.rightPanelWidth,
});
