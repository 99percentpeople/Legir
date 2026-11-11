/** Chat display contracts shared with the marketing demo; no SDK runtime dependencies. */

export type AiToolName =
  | "list_open_documents"
  | "get_document_context"
  | "get_document_metadata"
  | "update_document_metadata"
  | "unlock_pdf_permissions"
  | "inspect_pages_visual"
  | "get_pages_text"
  | "search_document"
  | "list_annotations"
  | "update_annotations"
  | "create_freetext_annotations"
  | "create_shape_annotations"
  | "list_fields"
  | "fill_form_fields"
  | "update_form_fields"
  | "create_form_fields"
  | "navigate"
  | "highlight_results"
  | "delete_annotations"
  | "clear_highlights";

export interface AiChatTokenUsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
}

export type AiAnnotationKind =
  "comment" | "highlight" | "ink" | "freetext" | "stamp" | "shape" | "link";

export interface AiChatSelectionAttachment {
  documentId?: string;
  kind: "workspace_selection";
  text: string;
  pageIndex: number;
  startOffset: number;
  endOffset: number;
  rect: { x: number; y: number; width: number; height: number };
}

export interface AiChatAnnotationAttachment {
  documentId?: string;
  kind: "annotation_reference";
  annotationId: string;
  annotationType: AiAnnotationKind;
  pageIndex: number;
  text?: string;
  highlightedText?: string;
  linkUrl?: string;
  linkDestPageIndex?: number;
  stampKind?: "preset" | "image";
  stampPresetId?: string;
  stampLabel?: string;
  stampHasImage?: boolean;
}

export type AiChatMessageAttachment =
  AiChatSelectionAttachment | AiChatAnnotationAttachment;

export type AiChatTimelineItem =
  | {
      id: string;
      kind: "message";
      role: "user" | "assistant" | "thinking";
      /** Persistent PDF identity selected when this model run began. */
      documentId?: string;
      turnId?: string;
      segmentIndex?: number;
      streamSegmentId?: string;
      text: string;
      showCollapsedPreview?: boolean;
      conversationText?: string;
      attachments?: AiChatMessageAttachment[];
      branchAnchorId?: string;
      durationMs?: number;
      createdAt: string;
      isStreaming?: boolean;
      turnCompleted?: boolean;
      isFinalAnswer?: boolean;
      turnDurationMs?: number;
      tokenUsageSnapshot?: AiChatTokenUsageSummary;
      contextTokensSnapshot?: number;
    }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      /** Actual tool target, retained even when persisted result text is truncated. */
      documentId?: string;
      turnId?: string;
      batchId?: string;
      isParallelBatch?: boolean;
      toolName: AiToolName;
      status: "running" | "done" | "error" | "incomplete";
      argsText: string;
      resultSummary?: string;
      progressItems?: AiToolExecutionProgressItem[];
      progressCounts?: AiToolExecutionProgressCounts;
      resultText?: string;
      previewImages?: AiChatToolPreviewImage[];
      error?: string;
      createdAt: string;
      turnCompleted?: boolean;
      turnDurationMs?: number;
      tokenUsageSnapshot?: AiChatTokenUsageSummary;
      contextTokensSnapshot?: number;
    };

export interface AiChatSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  parentSessionId?: string;
  branchDepth: number;
  branchKind?: "edit" | "regenerate";
  branchSourceMessageId?: string;
  branchContextUserMessageId?: string;
  branchContextUserAnchorId?: string;
}

export interface AiToolExecutionProgressItem {
  id: string;
  label: string;
  status: "pending" | "running" | "done";
  level?: number;
}

export interface AiToolExecutionProgressCounts {
  pending: number;
  running: number;
  done: number;
}

export interface AiChatToolPreviewImage {
  id: string;
  src: string;
  alt: string;
  label: string;
  width?: number;
  height?: number;
}

export type { AiDocumentLinkTarget } from "../utils/documentLinks";
