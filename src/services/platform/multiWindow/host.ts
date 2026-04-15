import type { EditorWindowId } from "@/app/editorTabs/types";
import type {
  OpenPlatformEditorWindowOptions,
  OpenPlatformEditorWindowResult,
  PlatformEditorTabWorkspaceEvent,
  PlatformEditorWindowInfo,
  PlatformFocusDocumentRequest,
} from "./types";
import { createBrowserPlatformMultiWindowHost } from "./browser/host";
import { getBrowserPlatformWindowId } from "./browser/coordinator";
import { createTauriPlatformMultiWindowHost } from "./tauri/host";
import { isDesktopApp, supportsPlatformMultiWindow } from "../runtime";

export interface PlatformCurrentWindowStatePatch {
  title?: string | null;
  sourceKeys?: string[];
}

export interface UnregisterPlatformCurrentWindowOptions {
  awaitReply?: boolean;
}

export interface PlatformMultiWindowHost {
  getCurrentWindowId: () => EditorWindowId;
  isSupported: () => boolean;
  focusWindow: (windowId: EditorWindowId) => Promise<boolean>;
  listEditorWindows: () => Promise<PlatformEditorWindowInfo[]>;
  listenWindowListChange: (listener: () => void) => Promise<() => void>;
  listenFocusDocumentRequest: (
    listener: (payload: PlatformFocusDocumentRequest) => void,
  ) => Promise<() => void>;
  listenWorkspaceEvent: (
    listener: (payload: PlatformEditorTabWorkspaceEvent) => void,
    targetWindowId?: EditorWindowId,
  ) => Promise<() => void>;
  openEditorWindow: (
    options?: OpenPlatformEditorWindowOptions,
  ) => Promise<OpenPlatformEditorWindowResult>;
  reportWindowDocuments: (sourceKeys: string[]) => Promise<void>;
  requestFocusExistingDocument: (sourceKey: string) => Promise<boolean>;
  syncCurrentWindowState: (
    patch: PlatformCurrentWindowStatePatch,
  ) => Promise<void>;
  unregisterCurrentWindow: (
    options?: UnregisterPlatformCurrentWindowOptions,
  ) => Promise<boolean>;
  emitWorkspaceEvent: (
    payload: PlatformEditorTabWorkspaceEvent,
    targetWindowId?: EditorWindowId,
  ) => Promise<void>;
}

const unsupportedPlatformMultiWindowHost: PlatformMultiWindowHost = {
  getCurrentWindowId: () =>
    isDesktopApp() ? "main" : getBrowserPlatformWindowId(),
  isSupported: () => false,
  focusWindow: async () => false,
  listEditorWindows: async () => [],
  listenWindowListChange: async () => () => {},
  listenFocusDocumentRequest: async () => () => {},
  listenWorkspaceEvent: async () => () => {},
  openEditorWindow: async () => ({
    ok: false,
    created: false,
    windowId: null,
    reason: "unsupported",
  }),
  reportWindowDocuments: async () => {},
  requestFocusExistingDocument: async () => false,
  syncCurrentWindowState: async () => {},
  unregisterCurrentWindow: async () => true,
  emitWorkspaceEvent: async () => {},
};

const browserPlatformMultiWindowHost = createBrowserPlatformMultiWindowHost();
const tauriPlatformMultiWindowHost = createTauriPlatformMultiWindowHost();

export const getPlatformMultiWindowHost = (): PlatformMultiWindowHost => {
  if (isDesktopApp()) {
    return tauriPlatformMultiWindowHost;
  }

  if (supportsPlatformMultiWindow()) {
    return browserPlatformMultiWindowHost;
  }

  return unsupportedPlatformMultiWindowHost;
};

export const getPlatformManagedWindowId = () => {
  return getPlatformMultiWindowHost().getCurrentWindowId();
};

export const syncPlatformCurrentWindowState = async (
  patch: PlatformCurrentWindowStatePatch,
) => {
  await getPlatformMultiWindowHost().syncCurrentWindowState(patch);
};

export const unregisterPlatformCurrentWindow = async (
  options?: UnregisterPlatformCurrentWindowOptions,
) => {
  return await getPlatformMultiWindowHost().unregisterCurrentWindow(options);
};
