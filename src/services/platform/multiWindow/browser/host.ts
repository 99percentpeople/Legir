import {
  emitBrowserPlatformMessage,
  focusBrowserPlatformWindow,
  getBrowserPlatformWindowId,
  listBrowserPlatformWindows,
  listenForBrowserPlatformMessage,
  openBrowserPlatformWindow,
  subscribeBrowserPlatformWindowRegistryChange,
  unregisterCurrentBrowserPlatformWindow,
  updateBrowserPlatformWindowState,
} from "./coordinator";
import type { PlatformMultiWindowHost } from "../host";
import {
  compareEditorWindowIds,
  createPlatformEditorWindowId,
  EDITOR_TAB_WORKSPACE_EVENT,
  FOCUS_DOCUMENT_REQUEST_EVENT,
  type OpenPlatformEditorWindowOptions,
  type PlatformEditorTabWorkspaceEvent,
  type PlatformFocusDocumentRequest,
} from "../types";
import { supportsPlatformMultiWindow } from "../../runtime";

export const createBrowserPlatformMultiWindowHost =
  (): PlatformMultiWindowHost => ({
    getCurrentWindowId: () =>
      supportsPlatformMultiWindow() ? getBrowserPlatformWindowId() : "current",

    isSupported: () => supportsPlatformMultiWindow(),

    focusWindow: async (windowId) => {
      return await focusBrowserPlatformWindow(windowId);
    },

    listEditorWindows: async () => {
      if (!supportsPlatformMultiWindow()) {
        return [];
      }

      const windows = await listBrowserPlatformWindows();
      return windows
        .sort((left, right) =>
          compareEditorWindowIds(left.windowId, right.windowId),
        )
        .map((windowInfo) => ({
          windowId: windowInfo.windowId,
          title: windowInfo.title,
        }));
    },

    listenWindowListChange: async (listener) => {
      return await subscribeBrowserPlatformWindowRegistryChange(listener);
    },

    listenFocusDocumentRequest: async (listener) => {
      if (!supportsPlatformMultiWindow()) {
        return () => {};
      }

      return await listenForBrowserPlatformMessage<PlatformFocusDocumentRequest>(
        FOCUS_DOCUMENT_REQUEST_EVENT,
        (payload) => {
          const sourceKey =
            typeof payload?.sourceKey === "string"
              ? payload.sourceKey.trim()
              : "";

          if (!sourceKey) {
            return;
          }

          try {
            window.focus();
          } catch {
            // ignore
          }

          listener({ sourceKey });
        },
      );
    },

    listenWorkspaceEvent: async (listener, targetWindowId) => {
      if (!supportsPlatformMultiWindow()) {
        return () => {};
      }

      const currentWindowId = getBrowserPlatformWindowId();
      if (targetWindowId && currentWindowId !== targetWindowId) {
        return () => {};
      }

      return await listenForBrowserPlatformMessage<PlatformEditorTabWorkspaceEvent>(
        EDITOR_TAB_WORKSPACE_EVENT,
        listener,
      );
    },

    openEditorWindow: async (options?: OpenPlatformEditorWindowOptions) => {
      if (!supportsPlatformMultiWindow()) {
        return {
          ok: false,
          created: false,
          windowId: null,
          reason: "unsupported" as const,
        };
      }

      const windowId = options?.windowId ?? createPlatformEditorWindowId();
      const opened = await openBrowserPlatformWindow({
        windowId,
        route: options?.route ?? "/editor",
        focus: options?.focus ?? true,
        inheritCurrentWindowState: options?.inheritCurrentWindowState,
      });

      if (!opened.ok) {
        return {
          ok: false,
          created: false,
          windowId: null,
          reason: opened.reason,
        };
      }

      return {
        ok: true,
        created: opened.created,
        windowId,
      };
    },

    reportWindowDocuments: async (sourceKeys) => {
      if (!supportsPlatformMultiWindow()) {
        return;
      }

      updateBrowserPlatformWindowState({ sourceKeys });
    },

    syncCurrentWindowState: async (patch) => {
      if (!supportsPlatformMultiWindow()) {
        return;
      }

      updateBrowserPlatformWindowState(patch);
    },

    requestFocusExistingDocument: async (sourceKey) => {
      if (!supportsPlatformMultiWindow()) {
        return false;
      }

      const currentWindowId = getBrowserPlatformWindowId();
      const targetWindow = (await listBrowserPlatformWindows())
        .filter((windowInfo) => windowInfo.windowId !== currentWindowId)
        .filter((windowInfo) => windowInfo.sourceKeys.includes(sourceKey))
        .sort((left, right) => right.updatedAt - left.updatedAt)[0];

      if (!targetWindow) {
        return false;
      }

      await emitBrowserPlatformMessage(
        FOCUS_DOCUMENT_REQUEST_EVENT,
        { sourceKey },
        targetWindow.windowId,
      );
      await focusBrowserPlatformWindow(targetWindow.windowId);
      return true;
    },

    unregisterCurrentWindow: async (options) => {
      if (!supportsPlatformMultiWindow()) {
        return true;
      }

      return await unregisterCurrentBrowserPlatformWindow(options);
    },

    emitWorkspaceEvent: async (payload, targetWindowId) => {
      if (!supportsPlatformMultiWindow()) {
        return;
      }

      await emitBrowserPlatformMessage(
        EDITOR_TAB_WORKSPACE_EVENT,
        payload,
        targetWindowId,
      );
    },
  });
