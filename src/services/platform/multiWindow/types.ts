import type { EditorWindowId } from "@/app/editorTabs/types";

export const EDITOR_TAB_WORKSPACE_EVENT = "app://editor-tab-workspace";
export const FOCUS_DOCUMENT_REQUEST_EVENT =
  "app://platform-focus-document-request";

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

export interface PlatformFocusDocumentRequest {
  sourceKey: string;
}

export interface PlatformEditorWindowInfo {
  windowId: EditorWindowId;
  title: string | null;
}

export interface OpenPlatformEditorWindowOptions {
  windowId?: EditorWindowId;
  route?: string;
  title?: string;
  focus?: boolean;
  inheritCurrentWindowState?: boolean;
}

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

export const isEditorPlatformWindowId = (windowId: string) =>
  windowId === "main" || windowId.startsWith("editor_");

export const compareEditorWindowIds = (left: string, right: string) => {
  if (left === right) return 0;
  if (left === "main") return -1;
  if (right === "main") return 1;
  return left.localeCompare(right);
};

export const createPlatformEditorWindowId = () =>
  `editor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
