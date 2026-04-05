import type { EditorTabSnapshot } from "@/app/editorTabs/types";

const STORAGE_KEY = "app-tauri-document-ui-sessions";
const MAX_ENTRIES = 50;

export type PersistedTauriDocumentUiSession = {
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

type PersistedTauriDocumentUiSessionEntry = {
  path: string;
  session: PersistedTauriDocumentUiSession;
};

const normalizePathKey = (path: string) => {
  const trimmed = path.trim();
  if (!trimmed) return "";

  const looksWindowsPath =
    /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\");

  if (looksWindowsPath) {
    return trimmed.replace(/\//g, "\\").toLowerCase();
  }

  return trimmed.replace(/\\/g, "/");
};

const clonePersistedSession = (
  session: PersistedTauriDocumentUiSession,
): PersistedTauriDocumentUiSession => ({
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
): PersistedTauriDocumentUiSession => ({
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

const readEntries = (): PersistedTauriDocumentUiSessionEntry[] => {
  if (typeof window === "undefined") return [];

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => {
        const path = typeof entry.path === "string" ? entry.path.trim() : "";
        const session =
          entry.session && typeof entry.session === "object"
            ? (entry.session as PersistedTauriDocumentUiSession)
            : null;
        if (!path || !session) return null;
        return {
          path,
          session: clonePersistedSession(session),
        };
      })
      .filter(
        (entry): entry is PersistedTauriDocumentUiSessionEntry =>
          entry !== null,
      );
  } catch {
    return [];
  }
};

const writeEntries = (entries: PersistedTauriDocumentUiSessionEntry[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
};

export const saveTauriDocumentUiSession = (
  path: string,
  snapshot: EditorTabSnapshot,
) => {
  const pathKey = normalizePathKey(path);
  if (!pathKey) return;

  const session = createPersistedSessionFromSnapshot(snapshot);
  const filtered = readEntries().filter(
    (entry) => normalizePathKey(entry.path) !== pathKey,
  );

  writeEntries(
    [
      {
        path,
        session,
      },
      ...filtered,
    ].slice(0, MAX_ENTRIES),
  );
};

export const getSavedTauriDocumentUiSession = (path: string) => {
  const pathKey = normalizePathKey(path);
  if (!pathKey) return null;

  const match = readEntries().find(
    (entry) => normalizePathKey(entry.path) === pathKey,
  );
  return match ? clonePersistedSession(match.session) : null;
};

export const applyTauriDocumentUiSession = (
  snapshot: EditorTabSnapshot,
  session: PersistedTauriDocumentUiSession,
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
