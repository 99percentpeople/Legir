import type { EditorState } from "@/types";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";

export const CURRENT_EDITOR_WINDOW_ID = "current";

export type EditorWindowId = string;

export type EditorTabSnapshot = Omit<
  EditorState,
  | "activeDialog"
  | "actionSignal"
  | "closeConfirmSource"
  | "isFullscreen"
  | "isProcessing"
  | "isSaving"
  | "keys"
  | "llmModelCache"
  | "options"
  | "processingStatus"
  | "thumbnailImages"
>;

export interface EditorTabSession {
  id: string;
  windowId: EditorWindowId;
  title: string;
  sourceKey: string | null;
  lastActiveAt: string;
  isDirty: boolean;
  editorSnapshot: EditorTabSnapshot;
  thumbnailImages: Record<number, string>;
  workerService: PDFWorkerService;
  disposePdfResources: (() => void) | null;
}

export interface EditorWindowLayout {
  windowId: EditorWindowId;
  tabIds: string[];
  activeTabId: string | null;
}

export interface EditorTabDescriptor {
  id: string;
  title: string;
  isDirty: boolean;
  isActive: boolean;
  isPendingTransfer?: boolean;
  pendingTransferSessionId?: string;
}

export interface EditorMergeWindowTarget {
  windowId: EditorWindowId;
  label: string;
}

export type EditorTabDropIntent =
  | "reorder"
  | "merge-to-window"
  | "detach-to-new-window";

export interface EditorTabDragPayload {
  tabId: string;
  sourceWindowId: EditorWindowId;
}

export interface EditorTabDropTarget {
  intent: EditorTabDropIntent;
  windowId: EditorWindowId;
  targetIndex?: number;
}
