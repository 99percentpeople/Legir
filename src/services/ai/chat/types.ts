import type { ZodTypeAny } from "zod";
import type { ToolSet } from "ai";
import type { PDFSearchMode } from "@/lib/pdfSearch";
import type { PDFMetadata, PDFOutlineItem, PDFSearchResult } from "@/types";

export type AiToolName =
  | "get_document_context"
  | "get_document_metadata"
  | "get_document_digest"
  | "read_pages"
  | "search_document"
  | "list_annotations"
  | "list_form_fields"
  | "fill_form_fields"
  | "focus_field"
  | "navigate_page"
  | "focus_result"
  | "highlight_results"
  | "clear_highlights";

export interface AiChatToolDefinition {
  name: string;
  description: string;
  accessType: "read" | "write";
  inputSchema: ZodTypeAny;
}

export interface AiChatMessageRecord {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface AiChatToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AiDocumentContext {
  filename: string;
  pageCount: number;
  currentPageNumber: number | null;
  visiblePageNumbers: number[];
  selectedText: string;
  outlinePreview: Array<{
    title: string;
    pageNumber?: number;
  }>;
}

export interface AiDocumentMetadata {
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

export interface AiDocumentDigestChunk {
  startPage: number;
  endPage: number;
  pageCount: number;
  charCount: number;
  excerpt: string;
}

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
}

export type AiAnnotationKind = "comment" | "highlight" | "ink" | "freetext";

export interface AiAnnotationSummary {
  id: string;
  pageNumber: number;
  type: AiAnnotationKind;
  text?: string;
  author?: string;
  color?: string;
  updatedAt?: string;
  rect?: { x: number; y: number; width: number; height: number };
  metaKind?: string;
}

export interface AiAnnotationListResult {
  total: number;
  returned: number;
  truncated: boolean;
  annotations: AiAnnotationSummary[];
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

export interface AiChatUiMessage {
  id: string;
  role: "user" | "assistant" | "thinking";
  text: string;
  conversationText?: string;
  attachments?: AiChatMessageAttachment[];
  branchAnchorId?: string;
  durationMs?: number;
  createdAt: string;
}

export interface AiChatSelectionAttachment {
  kind: "workspace_selection";
  text: string;
  pageIndex: number;
  startOffset: number;
  endOffset: number;
  rect: { x: number; y: number; width: number; height: number };
}

export type AiChatMessageAttachment = AiChatSelectionAttachment;

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
      text: string;
      conversationText?: string;
      attachments?: AiChatMessageAttachment[];
      branchAnchorId?: string;
      durationMs?: number;
      createdAt: string;
      isStreaming?: boolean;
    }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      batchId?: string;
      isParallelBatch?: boolean;
      toolName: AiToolName;
      status: "running" | "done" | "error";
      argsText: string;
      resultSummary?: string;
      resultText?: string;
      error?: string;
      createdAt: string;
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
}

export interface AiTextSelectionContext {
  text: string;
  pageIndex: number;
  startOffset: number;
  endOffset: number;
}

export interface AiDocumentContextService {
  getDocumentContext: () => AiDocumentContext;
  getDocumentMetadata: () => AiDocumentMetadata;
  getDocumentDigest?: (options: {
    startPage: number;
    endPage: number;
    charsPerChunk?: number;
    sourceCharsPerChunk?: number;
    summaryInstructions?: string;
    signal?: AbortSignal;
  }) => Promise<{
    pageCount: number;
    returnedPageCount: number;
    chunkCount: number;
    excerptCharsPerChunk: number;
    sourceCharsPerChunk: number;
    chunks: AiDocumentDigestChunk[];
  }>;
  readPages: (options: {
    pageNumbers: number[];
    includeLayout?: boolean;
    signal?: AbortSignal;
  }) => Promise<{
    requestedPageCount: number;
    returnedPageCount: number;
    truncated: boolean;
    maxPagesPerCall: number;
    pages: AiReadablePage[];
  }>;
  searchDocument: (options: {
    query: string;
    pageNumbers?: number[];
    caseSensitive?: boolean;
    mode?: PDFSearchMode;
    regexFlags?: string;
    maxResults?: number;
    signal?: AbortSignal;
  }) => Promise<PDFSearchResult[]>;
}

export interface AiToolExecutionContext {
  documentContextService: AiDocumentContextService;
  rememberSearchResults: (
    query: string,
    results: PDFSearchResult[],
  ) => AiSearchResultSummary[];
  listAnnotations: (options: {
    query?: string;
    pageNumbers?: number[];
    types?: AiAnnotationKind[];
    maxResults?: number;
  }) => AiAnnotationListResult;
  listFormFields: (options: {
    pageNumbers?: number[];
    query?: string;
    onlyEmpty?: boolean;
    includeReadOnly?: boolean;
    maxResults?: number;
  }) => AiFormFieldListResult;
  fillFormFields: (options: {
    updates: AiFormFieldFillRequest[];
  }) => AiFormFieldFillResult;
  focusField: (id: string) => AiFormFieldSummary | null;
  getStoredSearchResult: (id: string) => AiStoredSearchResult | null;
  createSearchHighlightAnnotations: (options: {
    resultIds?: string[];
    annotationText?: string;
    selectionAnchors?: Array<{
      attachmentIndex: number;
      startAnchor: string;
      endInclusiveAnchor: string;
      annotationText?: string;
    }>;
    documentAnchors?: Array<{
      startAnchor: string;
      endInclusiveAnchor: string;
      pageHint?: number;
      annotationText?: string;
    }>;
  }) => Promise<AiHighlightAnnotationCreateResult>;
  clearSearchHighlights: () => { clearedCount: number };
  setHighlightedResultIds: (ids: string[]) => void;
  clearHighlightedResultIds: () => void;
  navigatePage: (pageIndex: number) => void;
  focusSearchResult: (result: PDFSearchResult) => void;
}

export interface AiToolExecutionResult {
  payload: unknown;
  summary: string;
}

export interface AiToolRegistry {
  getDefinitions: () => AiChatToolDefinition[];
  execute: (
    name: string,
    rawArgs: unknown,
    signal?: AbortSignal,
  ) => Promise<AiToolExecutionResult>;
}

export type AiChatToolUpdate =
  | {
      phase: "start";
      call: AiChatToolCallRecord;
      batchId: string;
      isParallelBatch: boolean;
    }
  | {
      phase: "success";
      call: AiChatToolCallRecord;
      batchId: string;
      isParallelBatch: boolean;
      result: AiToolExecutionResult;
    }
  | {
      phase: "error";
      call: AiChatToolCallRecord;
      batchId: string;
      isParallelBatch: boolean;
      error: Error;
    };

export type AiChatAssistantUpdate =
  | { phase: "reasoning_delta"; turnId: string; delta: string }
  | { phase: "delta"; turnId: string; delta: string; branchAnchorId?: string }
  | {
      phase: "end";
      turnId: string;
      reasoningText: string;
      assistantMessage: string;
      branchAnchorId?: string;
      toolCalls: AiChatToolCallRecord[];
      finishReason: "stop" | "tool_calls";
    };

export interface AiChatToolRuntime {
  aiTools: ToolSet;
  toolCallsById: Map<string, AiChatToolCallRecord>;
  sawToolActivity: () => boolean;
  handleStreamToolError: (options: {
    toolCallId: string;
    toolName: string;
    input: unknown;
    batchId: string;
    error: unknown;
  }) => void;
}
