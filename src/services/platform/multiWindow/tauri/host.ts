import { invoke } from "@tauri-apps/api/core";
import { listen, emit, emitTo } from "@tauri-apps/api/event";
import {
  WebviewWindow,
  getAllWebviewWindows,
  getCurrentWebviewWindow,
} from "@tauri-apps/api/webviewWindow";
import type { PlatformMultiWindowHost } from "../host";
import {
  compareEditorWindowIds,
  createPlatformEditorWindowId,
  EDITOR_TAB_WORKSPACE_EVENT,
  FOCUS_DOCUMENT_REQUEST_EVENT,
  isEditorPlatformWindowId,
  type OpenPlatformEditorWindowOptions,
  type PlatformEditorTabWorkspaceEvent,
  type PlatformEditorWindowInfo,
  type PlatformFocusDocumentRequest,
} from "../types";
import { isWindowsPlatform } from "../../runtime";

type InheritedWindowState = {
  height?: number;
  width?: number;
};

const DEFAULT_EDITOR_WINDOW_SIZE = {
  width: 1280,
  height: 800,
};

const shouldDisableWebviewDragDropHandler = () => isWindowsPlatform();

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

const normalizeSourceKeys = (sourceKeys: string[]) =>
  Array.from(
    new Set(
      sourceKeys
        .map((sourceKey) => sourceKey.trim())
        .filter((sourceKey) => sourceKey.length > 0),
    ),
  );

export const createTauriPlatformMultiWindowHost =
  (): PlatformMultiWindowHost => ({
    getCurrentWindowId: () => {
      try {
        return getCurrentWebviewWindow().label;
      } catch {
        return "main";
      }
    },

    isSupported: () => true,

    focusWindow: async (windowId) => {
      const window = await WebviewWindow.getByLabel(windowId);
      if (!window) {
        return false;
      }

      await window.setFocus();
      return true;
    },

    listEditorWindows: async (): Promise<PlatformEditorWindowInfo[]> => {
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
    },

    listenWindowListChange: async () => () => {},

    listenFocusDocumentRequest: async (listener) => {
      return await listen<PlatformFocusDocumentRequest>(
        FOCUS_DOCUMENT_REQUEST_EVENT,
        (event) => {
          const sourceKey =
            typeof event.payload?.sourceKey === "string"
              ? event.payload.sourceKey.trim()
              : "";

          if (!sourceKey) {
            return;
          }

          listener({ sourceKey });
        },
      );
    },

    listenWorkspaceEvent: async (listener, targetWindowId) => {
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
    },

    openEditorWindow: async (options?: OpenPlatformEditorWindowOptions) => {
      const windowId = options?.windowId ?? createPlatformEditorWindowId();

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
          } as const;
        }

        const inheritedWindowState = options?.inheritCurrentWindowState
          ? await getInheritedCurrentWindowState()
          : undefined;

        const nextWindow = new WebviewWindow(windowId, {
          title: options?.title,
          url: options?.route ?? "/editor",
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
                    : new Error(
                        String(event.payload ?? "Failed to create window"),
                      ),
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
        } as const;
      } catch (error) {
        console.error("Failed to open editor window", error);
        return {
          ok: false,
          created: false,
          windowId: null,
          reason: "create_failed" as const,
        };
      }
    },

    reportWindowDocuments: async (sourceKeys) => {
      await invoke("report_platform_window_documents", {
        sourceKeys: normalizeSourceKeys(sourceKeys),
      });
    },

    syncCurrentWindowState: async () => {},

    requestFocusExistingDocument: async (sourceKey) => {
      const normalizedSourceKey = sourceKey.trim();
      if (!normalizedSourceKey) {
        return false;
      }

      return await invoke<boolean>("focus_existing_platform_document", {
        sourceKey: normalizedSourceKey,
      });
    },

    unregisterCurrentWindow: async () => true,

    emitWorkspaceEvent: async (payload, targetWindowId) => {
      if (targetWindowId) {
        await emitTo(targetWindowId, EDITOR_TAB_WORKSPACE_EVENT, payload);
        return;
      }

      await emit(EDITOR_TAB_WORKSPACE_EVENT, payload);
    },
  });
