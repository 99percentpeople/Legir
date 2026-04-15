import type { EditorWindowId } from "@/app/editorTabs/types";
import { getPlatformMultiWindowHost } from "./host";
import type {
  OpenPlatformEditorWindowOptions,
  OpenPlatformEditorWindowResult,
  PlatformEditorTabWorkspaceEvent,
  PlatformEditorWindowInfo,
} from "./types";
export {
  createPlatformEditorWindowId,
  type OpenPlatformEditorWindowResult,
  type PlatformEditorTabWorkspaceEvent,
  type PlatformEditorWindowInfo,
} from "./types";

export const openPlatformEditorWindow = async (
  options?: OpenPlatformEditorWindowOptions,
): Promise<OpenPlatformEditorWindowResult> => {
  return await getPlatformMultiWindowHost().openEditorWindow(options);
};

export const focusPlatformWindow = async (windowId: EditorWindowId) => {
  await getPlatformMultiWindowHost().focusWindow(windowId);
};

export const listPlatformEditorWindows = async (): Promise<
  PlatformEditorWindowInfo[]
> => {
  return await getPlatformMultiWindowHost().listEditorWindows();
};

export const listenForPlatformEditorWindowsChange = async (
  listener: () => void,
) => {
  return await getPlatformMultiWindowHost().listenWindowListChange(listener);
};

export const emitTabWorkspaceEvent = async (
  payload: PlatformEditorTabWorkspaceEvent,
  targetWindowId?: EditorWindowId,
) => {
  await getPlatformMultiWindowHost().emitWorkspaceEvent(
    payload,
    targetWindowId,
  );
};

export const listenForTabWorkspaceEvent = async (
  listener: (payload: PlatformEditorTabWorkspaceEvent) => void,
  targetWindowId?: EditorWindowId,
) => {
  return await getPlatformMultiWindowHost().listenWorkspaceEvent(
    listener,
    targetWindowId,
  );
};
