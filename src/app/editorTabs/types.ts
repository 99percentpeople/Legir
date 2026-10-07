import type { DocumentState } from "@/types";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";

export const CURRENT_EDITOR_WINDOW_ID = "current";

export type EditorWindowId = string;

// Explicit transfer fields: application preferences, window UI and resources
// cannot enter a document snapshot when new state fields are added.
export type EditorTabSnapshot = Pick<
  DocumentState,
  | "pdfFile"
  | "pdfBytes"
  | "pdfOpenPassword"
  | "exportPassword"
  | "metadata"
  | "documentPermissions"
  | "sourceDocumentPermissions"
  | "pdfOwnerUnlocked"
  | "pdfOwnerPassword"
  | "preservePdfOwnerRestrictionsOnSave"
  | "dirtyPermissionScopes"
  | "filename"
  | "saveTarget"
  | "pages"
  | "fields"
  | "annotations"
  | "preservedSourceAnnotations"
  | "outline"
  | "documentLoadState"
  | "documentLoadError"
  | "mode"
  | "tool"
  | "selectedId"
  | "scale"
  | "past"
  | "future"
  | "clipboard"
  | "pageTranslateParagraphCandidates"
  | "pageTranslateSelectedParagraphIds"
  | "lastSavedAt"
  | "isDirty"
  | "currentPageIndex"
  | "pendingViewStateRestore"
  | "fitTrigger"
>;

export interface EditorTabSession {
  runtime: import("./runtime").EditorTabRuntime;
  id: string;
  windowId: EditorWindowId;
  sourceKey: string | null;
  lastActiveAt: string;
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
