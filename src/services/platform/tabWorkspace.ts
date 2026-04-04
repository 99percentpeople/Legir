import { emit, emitTo } from "@tauri-apps/api/event";
import {
  WebviewWindow,
  getAllWebviewWindows,
  getCurrentWebviewWindow,
} from "@tauri-apps/api/webviewWindow";

import type { EditorWindowId } from "@/app/editorTabs/types";
import { isDesktopApp, isWindowsPlatform } from "./runtime";

const EDITOR_TAB_WORKSPACE_EVENT = "app://editor-tab-workspace";

export type PlatformEditorTabWorkspaceEvent =
  | {
      kind: "layout-changed";
      sourceWindowId: EditorWindowId;
      targetWindowId?: EditorWindowId;
      activeTabId?: string | null;
      tabIds?: string[];
    }
  | {
      kind: "session-detached";
      sourceWindowId: EditorWindowId;
      targetWindowId: EditorWindowId;
      sessionId: string;
      transferId: string;
      title: string;
      isDirty: boolean;
    }
  | {
      kind: "session-moved";
      sourceWindowId: EditorWindowId;
      targetWindowId: EditorWindowId;
      sessionId: string;
      transferId: string;
      title: string;
      isDirty: boolean;
    }
  | {
      kind: "session-transfer-ack";
      sourceWindowId: EditorWindowId;
      targetWindowId: EditorWindowId;
      sessionId: string;
      transferId: string;
    };

export type OpenPlatformEditorWindowResult =
  | {
      ok: true;
      created: boolean;
      windowId: EditorWindowId;
    }
  | {
      ok: false;
      created: false;
      windowId: null;
      reason: "unsupported" | "create_failed";
    };

export interface PlatformEditorWindowInfo {
  windowId: EditorWindowId;
  title: string | null;
}

type InheritedWindowState = {
  height?: number;
  width?: number;
};

const DEFAULT_EDITOR_WINDOW_SIZE = {
  width: 1280,
  height: 800,
};

const shouldDisableWebviewDragDropHandler = () => isWindowsPlatform();

const isEditorPlatformWindowId = (windowId: string) =>
  windowId === "main" || windowId.startsWith("editor_");

const compareEditorWindowIds = (left: string, right: string) => {
  if (left === right) return 0;
  if (left === "main") return -1;
  if (right === "main") return 1;
  return left.localeCompare(right);
};

export const createPlatformEditorWindowId = () =>
  `editor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const getInheritedCurrentWindowState =
  async (): Promise<InheritedWindowState> => {
    try {
      const currentWindow = getCurrentWebviewWindow();
      const [scaleFactor, outerSize, isMaximized] = await Promise.all([
        currentWindow.scaleFactor(),
        currentWindow.outerSize(),
        currentWindow.isMaximized(),
      ]);

      if (isMaximized) {
        return {
          width: DEFAULT_EDITOR_WINDOW_SIZE.width,
          height: DEFAULT_EDITOR_WINDOW_SIZE.height,
        };
      }

      const logicalSize = outerSize.toLogical(scaleFactor);

      return {
        width: Math.max(1, Math.round(logicalSize.width)),
        height: Math.max(1, Math.round(logicalSize.height)),
      };
    } catch (error) {
      console.error("Failed to inherit current window size:", error);
      return DEFAULT_EDITOR_WINDOW_SIZE;
    }
  };

export const openPlatformEditorWindow = async (options?: {
  windowId?: EditorWindowId;
  route?: string;
  title?: string;
  focus?: boolean;
  inheritCurrentWindowState?: boolean;
}): Promise<OpenPlatformEditorWindowResult> => {
  if (!isDesktopApp()) {
    return {
      ok: false,
      created: false,
      windowId: null,
      reason: "unsupported",
    };
  }

  const windowId = options?.windowId ?? createPlatformEditorWindowId();
  const route = options?.route ?? "/editor";

  try {
    const existing = await WebviewWindow.getByLabel(windowId);
    if (existing) {
      if (options?.focus !== false) {
        await existing.setFocus();
      }
      return {
        ok: true,
        created: false,
        windowId,
      };
    }

    const inheritedWindowState = options?.inheritCurrentWindowState
      ? await getInheritedCurrentWindowState()
      : undefined;

    const nextWindow = new WebviewWindow(windowId, {
      title: options?.title,
      url: route,
      focus: options?.focus ?? true,
      ...(shouldDisableWebviewDragDropHandler()
        ? { dragDropEnabled: false }
        : {}),
      ...inheritedWindowState,
    });

    await new Promise<void>((resolve, reject) => {
      let didSettle = false;
      let unlistenCreated: (() => void) | null = null;
      let unlistenError: (() => void) | null = null;

      const settle = (fn: () => void) => {
        if (didSettle) return;
        didSettle = true;
        try {
          unlistenCreated?.();
        } catch {
          // ignore
        }
        try {
          unlistenError?.();
        } catch {
          // ignore
        }
        fn();
      };

      nextWindow
        .once("tauri://created", () => {
          settle(() => resolve());
        })
        .then((unlisten) => {
          unlistenCreated = unlisten;
        })
        .catch(reject);

      nextWindow
        .once("tauri://error", (event) => {
          settle(() =>
            reject(
              event.payload instanceof Error
                ? event.payload
                : new Error(String(event.payload ?? "Failed to create window")),
            ),
          );
        })
        .then((unlisten) => {
          unlistenError = unlisten;
        })
        .catch(reject);
    });

    return {
      ok: true,
      created: true,
      windowId,
    };
  } catch (error) {
    console.error("Failed to open editor window", error);
    return {
      ok: false,
      created: false,
      windowId: null,
      reason: "create_failed",
    };
  }
};

export const focusPlatformWindow = async (windowId: EditorWindowId) => {
  if (!isDesktopApp()) return;
  const window = await WebviewWindow.getByLabel(windowId);
  if (!window) return;
  await window.setFocus();
};

export const listPlatformEditorWindows = async (): Promise<
  PlatformEditorWindowInfo[]
> => {
  if (!isDesktopApp()) return [];

  const windows = await getAllWebviewWindows();
  const editorWindows = windows
    .filter((window) => isEditorPlatformWindowId(window.label))
    .sort((left, right) => compareEditorWindowIds(left.label, right.label));

  return await Promise.all(
    editorWindows.map(async (window) => ({
      windowId: window.label,
      title: await window.title().catch(() => null),
    })),
  );
};

export const emitTabWorkspaceEvent = async (
  payload: PlatformEditorTabWorkspaceEvent,
  targetWindowId?: EditorWindowId,
) => {
  if (!isDesktopApp()) return;

  if (targetWindowId) {
    await emitTo(targetWindowId, EDITOR_TAB_WORKSPACE_EVENT, payload);
    return;
  }

  await emit(EDITOR_TAB_WORKSPACE_EVENT, payload);
};

export const listenForTabWorkspaceEvent = async (
  listener: (payload: PlatformEditorTabWorkspaceEvent) => void,
  targetWindowId?: EditorWindowId,
) => {
  if (!isDesktopApp()) {
    return () => {};
  }

  const currentWindow = getCurrentWebviewWindow();
  if (targetWindowId && currentWindow.label !== targetWindowId) {
    return () => {};
  }

  return await currentWindow.listen<PlatformEditorTabWorkspaceEvent>(
    EDITOR_TAB_WORKSPACE_EVENT,
    (event) => {
      listener(event.payload);
    },
  );
};
