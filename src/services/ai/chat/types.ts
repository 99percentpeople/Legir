/**
 * Stable AI chat data contracts.
 *
 * This file defines the serialized or cross-module shapes used by the AI chat
 * system: tool definitions, messages, tool results, readable page payloads, and
 * related records. Runtime context composition and execution wiring should live
 * alongside the runtime implementation instead of here.
 */
import type { ZodTypeAny } from "zod";
import type { ModelMessage, ToolSet } from "ai";
import type { ToolResultOutput } from "@ai-sdk/provider-utils";
import type { AiDocumentLinkTarget } from "@/services/ai/utils/documentLinks";
import type {
  LLMModelCapabilities,
  LLMModelModality,
  PageFlowDirection,
  PageLayoutMode,
  PDFMetadata,
  PDFOutlineItem,
  PDFSearchResult,
} from "@/types";

export type AiToolName =
  | "get_document_context"
  | "get_document_metadata"
  | "get_pages_visual"
  | "summarize_pages_visual"
  | "get_document_digest"
  | "get_pages_text"
  | "search_document"
  | "list_annotations"
  | "update_annotation_texts"
  | "update_highlight_annotations"
  | "update_freetext_annotations"
  | "update_shape_annotations"
  | "create_freetext_annotations"
  | "create_shape_annotations"
  | "list_fields"
  | "fill_form_fields"
  | "update_form_fields"
  | "detect_form_fields"
  | "create_form_fields"
  | "focus_control"
  | "navigate_page"
  | "focus_result"
  | "highlight_results"
  | "delete_annotations"
  | "clear_highlights";

export interface AiChatToolDefinition {
  name: string;
  description: string;
  accessType: "read" | "write";
  inputSchema: ZodTypeAny;
  promptInstructions?: string[];
  requiredInputModalities?: LLMModelModality[];
  toModelOutput?: (options: {
    toolCallId: string;
    input: unknown;
    output: unknown;
  }) => ToolResultOutput | PromiseLike<ToolResultOutput>;
}

export type AiChatMessageRecord = ModelMessage;

export type AiChatRuntimeTranscriptVersion = 1;

export interface AiChatRuntimeTranscript {
  version: AiChatRuntimeTranscriptVersion;
  messages: AiChatMessageRecord[];
  modelKey?: string;
  updatedAt: string;
  timelineBoundaries: Record<string, number>;
}

export interface AiChatToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AiChatTokenUsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
}

export type { AiDocumentLinkTarget };

export interface AiTypeCount<TType extends string = string> {
  type: TType;
  count: number;
}

export interface AiDocumentPageAssetSummary {
  pageNumber: number;
  formFieldTypes: AiTypeCount<AiFormFieldKind>[];
  annotationTypes: AiTypeCount<AiAnnotationKind>[];
}

export interface AiPageSpaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AiDocumentViewportPageRect {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  rect: AiPageSpaceRect;
}

export interface AiDocumentContext {
  pageCount: number;
  currentPageNumber: number | null;
  visiblePageNumbers: number[];
  currentViewportRect: AiDocumentViewportPageRect | null;
  viewportPageRects: AiDocumentViewportPageRect[];
  scale: number;
  zoomPercent: number;
  pageLayout: PageLayoutMode;
  pageFlow: PageFlowDirection;
  selectedText: string;
  pageAssetSummary: AiDocumentPageAssetSummary[];
  outlinePreview: Array<{
    title: string;
    pageNumber?: number;
  }>;
}

export interface AiDocumentMetadata {
  filename: string;
  title?: string;
  author?: string;
  subject?: string;
  keywords: string[];
  creator?: string;
  producer?: string;
  creationDate?: string;
  modificationDate?: string;
}

export interface AiReadablePageLine {
  text: string;
  rect: { x: number; y: number; width: number; height: number };
}

export interface AiReadablePage {
  pageNumber: number;
  text: string;
  charCount: number;
  lineCount?: number;
  lines?: AiReadablePageLine[];
}

export interface AiRenderedPageImage {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  rotation: number;
  cropRect?: AiPageSpaceRect;
  pixelDensity: number;
  renderedWidth: number;
  renderedHeight: number;
  mimeType: string;
  renderAnnotations: boolean;
  base64Data: string;
}

export interface AiRenderedPageImageBatch {
  requestedPageCount: number;
  returnedPageCount: number;
  truncated: boolean;
  maxPagesPerCall: number;
  pages: AiRenderedPageImage[];
}

export interface AiRenderedPageVisualSummaryPage {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  rotation: number;
  cropRect?: AiPageSpaceRect;
  pixelDensity: number;
  renderedWidth: number;
  renderedHeight: number;
  renderAnnotations: boolean;
}

export interface AiRenderedPageVisualSummaryResult {
  requestedPageCount: number;
  returnedPageCount: number;
  truncated: boolean;
  maxPagesPerCall: number;
  pages: AiRenderedPageVisualSummaryPage[];
  summary: string;
}

export interface AiSummaryInstructions {
  known_information?: string;
  remaining_uncertainties?: string;
  what_to_add_or_verify?: string;
}

export interface AiDocumentDigestChunk {
  startPage: number;
  endPage: number;
  pageCount: number;
  charCount: number;
  excerpt: string;
}

export type AiDocumentDigestSourceKind = "page_text" | "chunk_summaries";

export interface AiStoredSearchResult {
  id: string;
  query: string;
  result: PDFSearchResult;
}

export interface AiSearchResultSummary {
  resultId: string;
  pageNumber: number;
  matchText: string;
  snippet: string;
  highlightBehavior: "exact_match_only";
  snippetPurpose: "context_only";
}

export type AiAnnotationKind =
  | "comment"
  | "highlight"
  | "ink"
  | "freetext"
  | "stamp"
  | "shape"
  | "link";

export type AiShapeAnnotationSubType =
  | "square"
  | "circle"
  | "line"
  | "polyline"
  | "polygon"
  | "cloud_polygon"
  | "arrow"
  | "cloud";

export interface AiAnnotationSummary {
  id: string;
  pageNumber: number;
  type: AiAnnotationKind;
  subType?: AiShapeAnnotationSubType;
  text?: string;
  highlightedText?: string;
  author?: string;
  color?: string;
  updatedAt?: string;
  rect?: { x: number; y: number; width: number; height: number };
  linkUrl?: string;
  linkDestPageNumber?: number;
  metaKind?: string;
  stampKind?: "preset" | "image";
  stampPresetId?: string;
  stampLabel?: string;
  stampHasImage?: boolean;
}

export interface AiAnnotationListResult {
  total: number;
  returned: number;
  truncated: boolean;
  annotations: AiAnnotationSummary[];
}

export interface AiAnnotationTextUpdateResult {
  ok: boolean;
  annotationId: string;
  pageNumber?: number;
  type?: AiAnnotationKind;
  previousText?: string;
  text?: string;
  status: "updated" | "unchanged" | "rejected";
  reason?: string;
}

export interface AiAnnotationTextBatchUpdateResult {
  updatedCount: number;
  unchangedCount: number;
  rejectedCount: number;
  updates: AiAnnotationTextUpdateResult[];
}

export interface AiHighlightAnnotationSummary {
  id: string;
  pageNumber: number;
  matchText: string;
  source: "result" | "selection_attachment" | "document_anchor";
  resultId?: string;
  attachmentIndex?: number;
  startAnchor?: string;
  endInclusiveAnchor?: string;
  annotationText?: string;
}

export interface AiHighlightAnnotationCreateResult {
  requestedCount: number;
  createdCount: number;
  skippedExistingCount: number;
  missingCount: number;
  annotations: AiHighlightAnnotationSummary[];
  missingResultIds?: string[];
  missingSelectionAnchors?: Array<{
    attachmentIndex: number;
    startAnchor: string;
    endInclusiveAnchor: string;
    annotationText?: string;
  }>;
  missingDocumentAnchors?: Array<{
    startAnchor: string;
    endInclusiveAnchor: string;
    pageHint?: number;
    annotationText?: string;
  }>;
}

export interface AiAnnotationDeleteResultItem {
  ok: boolean;
  annotationId: string;
  pageNumber?: number;
  type?: AiAnnotationKind;
  subType?: AiShapeAnnotationSubType;
  highlightedText?: string;
  text?: string;
  status: "deleted" | "rejected";
  reason?: string;
}

export interface AiAnnotationDeleteBatchResult {
  deletedCount: number;
  rejectedCount: number;
  deletions: AiAnnotationDeleteResultItem[];
}

export interface AiCreateAnnotationResultItem {
  annotationId?: string;
  pageNumber?: number;
  type?: AiAnnotationKind;
  subType?: AiShapeAnnotationSubType;
  text?: string;
  rect?: { x: number; y: number; width: number; height: number };
  status: "created" | "skipped" | "rejected";
  reason?: string;
}

export interface AiCreateAnnotationsResult {
  createdCount: number;
  skippedCount: number;
  rejectedCount: number;
  annotations: AiCreateAnnotationResultItem[];
}

export interface AiCreateFreetextAnnotationInput {
  pageNumber?: number;
  text?: string;
  rect?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  style?: {
    color?: string;
    opacity?: number;
    backgroundColor?: string;
    borderColor?: string;
    borderWidth?: number;
    fontSize?: number;
    fontFamily?: string;
    lineHeight?: number;
    alignment?: "left" | "center" | "right";
    flatten?: boolean;
    rotationDeg?: number;
  };
}

export interface AiCreateShapeAnnotationInput {
  pageNumber?: number;
  shapeType?: AiShapeAnnotationSubType;
  rect?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  points?: Array<{ x?: number; y?: number }>;
  annotationText?: string;
  style?: {
    color?: string;
    opacity?: number;
    backgroundColor?: string;
    backgroundOpacity?: number;
    thickness?: number;
    arrowSize?: number;
    startArrowStyle?:
      | "closed_arrow"
      | "line_arrow"
      | "hollow_arrow"
      | "circle"
      | "square"
      | "diamond"
      | "slash";
    endArrowStyle?:
      | "closed_arrow"
      | "line_arrow"
      | "hollow_arrow"
      | "circle"
      | "square"
      | "diamond"
      | "slash";
    cloudIntensity?: number;
    cloudSpacing?: number;
  };
}

export interface AiUpdateAnnotationInput {
  annotationId: string;
  annotationType: AiAnnotationKind;
  text?: string;
  rect?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  style?: {
    color?: string;
    opacity?: number;
    backgroundColor?: string;
    backgroundOpacity?: number;
    borderColor?: string;
    borderWidth?: number;
    fontSize?: number;
    fontFamily?: string;
    lineHeight?: number;
    alignment?: "left" | "center" | "right";
    flatten?: boolean;
    rotationDeg?: number;
    thickness?: number;
    arrowSize?: number;
    startArrowStyle?:
      | "closed_arrow"
      | "line_arrow"
      | "hollow_arrow"
      | "circle"
      | "square"
      | "diamond"
      | "slash";
    endArrowStyle?:
      | "closed_arrow"
      | "line_arrow"
      | "hollow_arrow"
      | "circle"
      | "square"
      | "diamond"
      | "slash";
    cloudIntensity?: number;
    cloudSpacing?: number;
  };
}

export interface AiAnnotationUpdateResultItem {
  annotationId: string;
  pageNumber?: number;
  type?: AiAnnotationKind;
  subType?: AiShapeAnnotationSubType;
  status: "updated" | "unchanged" | "rejected";
  reason?: string;
  updatedProperties?: string[];
}

export interface AiAnnotationUpdateResult {
  updatedCount: number;
  unchangedCount: number;
  rejectedCount: number;
  updates: AiAnnotationUpdateResultItem[];
}

export type AiFormFieldKind =
  | "text"
  | "checkbox"
  | "radio"
  | "dropdown"
  | "signature";

export type AiFormFieldValue = string | string[] | boolean | null;

export interface AiFormFieldSummary {
  id: string;
  pageNumber: number;
  name: string;
  type: AiFormFieldKind;
  required: boolean;
  readOnly: boolean;
  editable: boolean;
  isEmpty: boolean;
  toolTip?: string;
  currentValue: AiFormFieldValue;
  defaultValue: AiFormFieldValue;
  options?: string[];
  isMultiSelect?: boolean;
  allowCustomValue?: boolean;
  optionValue?: string;
  rect?: { x: number; y: number; width: number; height: number };
  unsupportedReason?: string;
}

export interface AiFormFieldListResult {
  total: number;
  returned: number;
  truncated: boolean;
  fields: AiFormFieldSummary[];
}

export interface AiFormFieldFillRequest {
  fieldId: string;
  value?: string | string[];
  checked?: boolean;
}

export interface AiFormFieldFillResultItem {
  fieldId: string;
  pageNumber?: number;
  name?: string;
  type?: AiFormFieldKind;
  status: "updated" | "rejected";
  reason?: string;
  affectedFieldIds?: string[];
  currentValue?: AiFormFieldValue;
}

export interface AiFormFieldFillResult {
  updatedCount: number;
  rejectedCount: number;
  updates: AiFormFieldFillResultItem[];
}

export interface AiUpdateFormFieldInput {
  fieldId: string;
  rect?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  required?: boolean;
  readOnly?: boolean;
  toolTip?: string;
  placeholder?: string;
  options?: string[];
  multiline?: boolean;
  alignment?: "left" | "center" | "right";
  isMultiSelect?: boolean;
  allowCustomValue?: boolean;
  exportValue?: string;
  style?: {
    borderColor?: string;
    backgroundColor?: string;
    borderWidth?: number;
    borderStyle?: "solid" | "dashed" | "underline";
    textColor?: string;
    fontSize?: number;
    fontFamily?: string;
    isTransparent?: boolean;
  };
}

export interface AiFormFieldUpdateResultItem {
  fieldId: string;
  pageNumber?: number;
  name?: string;
  type?: AiFormFieldKind;
  status: "updated" | "unchanged" | "rejected";
  reason?: string;
  affectedFieldIds?: string[];
  updatedProperties?: string[];
}

export interface AiFormFieldUpdateResult {
  updatedCount: number;
  unchangedCount: number;
  rejectedCount: number;
  updates: AiFormFieldUpdateResultItem[];
}

export interface AiDetectedFormFieldDraft {
  draftId: string;
  pageNumber: number;
  name: string;
  type: AiFormFieldKind;
  rect: { x: number; y: number; width: number; height: number };
  options?: string[];
  multiline?: boolean;
  alignment?: "left" | "center" | "right";
}

export interface AiCreateFormFieldInput {
  pageNumber: number;
  name: string;
  type: AiFormFieldKind;
  rect: { x: number; y: number; width: number; height: number };
  required?: boolean;
  readOnly?: boolean;
  toolTip?: string;
  placeholder?: string;
  options?: string[];
  multiline?: boolean;
  alignment?: "left" | "center" | "right";
  isMultiSelect?: boolean;
  allowCustomValue?: boolean;
  exportValue?: string;
  style?: {
    borderColor?: string;
    backgroundColor?: string;
    borderWidth?: number;
    borderStyle?: "solid" | "dashed" | "underline";
    textColor?: string;
    fontSize?: number;
    fontFamily?: string;
    isTransparent?: boolean;
  };
}

export interface AiDetectedFormFieldBatch {
  batchId: string;
  status: "draft" | "applied" | "discarded";
  createdAt: string;
  pageNumbers: number[];
  requestedPageCount: number;
  detectedCount: number;
  userIntent?: string;
  allowedTypes?: AiFormFieldKind[];
  extraPrompt?: string;
  fields: AiDetectedFormFieldDraft[];
}

export interface AiCreateFormFieldsResultItem {
  draftId?: string;
  fieldId?: string;
  pageNumber?: number;
  name?: string;
  type?: AiFormFieldKind;
  status: "created" | "skipped" | "rejected";
  reason?: string;
}

export interface AiCreateFormFieldsResult {
  batchId?: string;
  status: "created" | "not_found" | "rejected";
  createdCount: number;
  skippedCount: number;
  rejectedCount: number;
  fields: AiCreateFormFieldsResultItem[];
  reason?: string;
}

export interface AiChatUiMessage {
  id: string;
  role: "user" | "assistant" | "thinking";
  text: string;
  showCollapsedPreview?: boolean;
  conversationText?: string;
  attachments?: AiChatMessageAttachment[];
  branchAnchorId?: string;
  durationMs?: number;
  createdAt: string;
}

export interface AiChatContextMemory {
  text: string;
  coveredTimelineItemCount: number;
  coveredMessageCount: number;
  updatedAt: string;
}

export interface AiChatSelectionAttachment {
  kind: "workspace_selection";
  text: string;
  pageIndex: number;
  startOffset: number;
  endOffset: number;
  rect: { x: number; y: number; width: number; height: number };
}

export interface AiChatAnnotationAttachment {
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
  | AiChatSelectionAttachment
  | AiChatAnnotationAttachment;

export type AiChatUserMessageInput =
  | string
  | {
      text: string;
      displayText?: string;
      attachments?: AiChatMessageAttachment[];
      editContext?: {
        sourceSessionId: string;
        targetMessageId: string;
      };
    };

export interface AiToolCallRecord {
  id: string;
  toolName: AiToolName;
  status: "pending" | "running" | "done" | "error";
  argsText: string;
  resultSummary?: string;
  error?: string;
}

export type AiChatTimelineItem =
  | {
      id: string;
      kind: "message";
      role: "user" | "assistant" | "thinking";
      turnId?: string;
      segmentIndex?: number;
      text: string;
      showCollapsedPreview?: boolean;
      conversationText?: string;
      attachments?: AiChatMessageAttachment[];
      branchAnchorId?: string;
      durationMs?: number;
      createdAt: string;
      isStreaming?: boolean;
      turnCompleted?: boolean;
      tokenUsageSnapshot?: AiChatTokenUsageSummary;
      contextTokensSnapshot?: number;
    }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      turnId?: string;
      batchId?: string;
      isParallelBatch?: boolean;
      toolName: AiToolName;
      status: "running" | "done" | "error" | "incomplete";
      argsText: string;
      resultSummary?: string;
      progressDetails?: string[];
      progressItems?: AiToolExecutionProgressItem[];
      progressCounts?: AiToolExecutionProgressCounts;
      resultText?: string;
      previewImages?: AiChatToolPreviewImage[];
      error?: string;
      createdAt: string;
      turnCompleted?: boolean;
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

export interface AiDocumentSnapshot {
  filename: string;
  metadata: PDFMetadata;
  pages: Array<{
    pageIndex: number;
    width: number;
    height: number;
    viewBox: [number, number, number, number];
    userUnit: number;
    rotation: number;
  }>;
  outline: PDFOutlineItem[];
  currentPageIndex: number;
  scale: number;
  pageLayout: PageLayoutMode;
  pageFlow: PageFlowDirection;
}

export interface AiTextSelectionContext {
  text: string;
  pageIndex: number;
  startOffset: number;
  endOffset: number;
}

export interface AiToolExecutionResult {
  payload: unknown;
  summary: string;
  modelOutput?: unknown;
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

export interface AiToolExecutionProgress {
  summary: string;
  details?: string[];
  items?: AiToolExecutionProgressItem[];
  counts?: AiToolExecutionProgressCounts;
}

export interface AiChatToolPreviewImage {
  id: string;
  src: string;
  alt: string;
  label: string;
  width?: number;
  height?: number;
}

export interface AiToolRegistry {
  getDefinitions: () => AiChatToolDefinition[];
  execute: (
    name: string,
    rawArgs: unknown,
    signal?: AbortSignal,
    onProgress?: (progress: AiToolExecutionProgress) => void,
  ) => Promise<AiToolExecutionResult>;
}

export type AiChatToolUpdate = (
  | { phase: "start" }
  | { phase: "success"; result: AiToolExecutionResult }
  | { phase: "progress"; progress: AiToolExecutionProgress }
  | { phase: "error"; error: Error }
) & {
  call: AiChatToolCallRecord;
  batchId: string;
  isParallelBatch: boolean;
};

export type AiChatAssistantUpdate = (
  | {
      phase: "reasoning_delta";
      delta: string;
      showCollapsedPreview?: boolean;
    }
  | {
      phase: "delta";
      delta: string;
      branchAnchorId?: string;
    }
  | {
      phase: "end";
      reasoningText: string;
      showCollapsedPreview?: boolean;
      assistantMessage: string;
      branchAnchorId?: string;
      toolCalls: AiChatToolCallRecord[];
      finishReason: "stop" | "tool_calls";
    }
) & { turnId: string };

export interface AiChatToolRuntime {
  tools: ToolSet;
  toolCallsById: Map<string, AiChatToolCallRecord>;
  handleStreamToolError: (options: {
    toolCallId: string;
    toolName: string;
    input: unknown;
    batchId: string;
    error: unknown;
  }) => void;
}

export interface AiToolRegistryOptions {
  modelCapabilities?: LLMModelCapabilities;
}
