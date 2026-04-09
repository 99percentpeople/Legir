import {
  normalizeAiToolArgsDeep,
  toSnakeCaseKeysDeep,
} from "@/services/ai/utils/toolCase";
import { omitEmptyArrayFieldsDeep } from "@/services/ai/utils/json";
import type { ToolResultOutput } from "@ai-sdk/provider-utils";
import type {
  AiChatContextMemory,
  AiChatMessageAttachment,
  AiChatMessageRecord,
  AiChatSelectionAttachment,
  AiDetectedFormFieldDraft,
  AiChatTokenUsageSummary,
  AiFormFieldKind,
  AiChatSessionSummary,
  AiChatTimelineItem,
  AiChatUserMessageInput,
  AiStoredSearchResult,
} from "@/services/ai/chat/types";
import type { FormField, PDFSearchResult } from "@/types";

export type AiChatRunStatus = "idle" | "running" | "cancelling" | "error";

export const AI_CHAT_SELECTED_MODEL_KEY = "app-ai-chat:selected-model";

const AI_CHAT_PERSIST_VERSION = 1;
const AI_CHAT_PERSIST_KEY_PREFIX = "app-ai-chat:";
const MAX_PERSIST_SESSIONS = 20;
const MAX_PERSIST_TIMELINE_ITEMS = 300;
const MAX_PERSIST_SEARCH_RESULTS = 800;
const MAX_PERSIST_MESSAGE_CHARS = 60_000;
const MAX_PERSIST_TOOL_ARGS_CHARS = 20_000;
const MAX_PERSIST_TOOL_RESULT_CHARS = 80_000;
const MAX_PERSIST_TOOL_SUMMARY_CHARS = 8_000;

export type PersistedAiChatSession = {
  id: string;
  title: string;
  updatedAt: string;
  parentSessionId?: string;
  branchDepth?: number;
  branchKind?: "edit" | "regenerate";
  branchSourceMessageId?: string;
  branchContextUserMessageId?: string;
  branchContextUserAnchorId?: string;
  timeline: AiChatTimelineItem[];
  searchResults: AiStoredSearchResult[];
  highlightedResultIds: string[];
  pendingDetectedFieldBatches?: AiDetectedFormFieldBatchState[];
  contextMemory?: AiChatContextMemory;
  tokenUsage?: AiChatTokenUsageSummary;
  contextTokens?: number;
  contextTokenOverhead?: number;
  lastError?: string | null;
  awaitingContinue?: boolean;
};

type PersistedAiChatState = {
  version: number;
  activeSessionId: string;
  sessions: PersistedAiChatSession[];
};

export type AiChatSessionData = {
  id: string;
  title: string;
  updatedAt: string;
  parentSessionId?: string;
  branchDepth: number;
  branchKind?: "edit" | "regenerate";
  branchSourceMessageId?: string;
  branchContextUserMessageId?: string;
  branchContextUserAnchorId?: string;
  timeline: AiChatTimelineItem[];
  conversation: AiChatMessageRecord[];
  searchResultsById: Map<string, AiStoredSearchResult>;
  highlightedResultIds: string[];
  pendingDetectedFieldBatches: AiDetectedFormFieldBatchState[];
  contextMemory?: AiChatContextMemory;
  tokenUsage: AiChatTokenUsageSummary;
  contextTokens: number;
  contextTokenOverhead: number;
  runStatus: AiChatRunStatus;
  lastError: string | null;
  awaitingContinue: boolean;
};

export type AiDetectedFormFieldDraftState = {
  draftId: string;
  field: FormField;
  summary: AiDetectedFormFieldDraft;
};

export type AiDetectedFormFieldBatchState = {
  batchId: string;
  createdAt: string;
  status: "draft" | "applied" | "discarded";
  pageNumbers: number[];
  allowedTypes?: AiFormFieldKind[];
  userIntent?: string;
  extraPrompt?: string;
  confirmedAt?: string;
  confirmedByMessageId?: string;
  confirmedByUserText?: string;
  drafts: AiDetectedFormFieldDraftState[];
};

export type RestoredAiChatDocumentState = {
  activeSessionId: string;
  sessionsMap: Map<string, AiChatSessionData>;
  sessionSummaries: AiChatSessionSummary[];
};

export const createEmptyAiChatTokenUsageSummary =
  (): AiChatTokenUsageSummary => ({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
  });

export const addAiChatTokenUsageSummary = (
  base: AiChatTokenUsageSummary,
  delta: Partial<AiChatTokenUsageSummary> | null | undefined,
): AiChatTokenUsageSummary => ({
  inputTokens:
    base.inputTokens + Math.max(0, Math.trunc(delta?.inputTokens ?? 0)),
  outputTokens:
    base.outputTokens + Math.max(0, Math.trunc(delta?.outputTokens ?? 0)),
  totalTokens:
    base.totalTokens + Math.max(0, Math.trunc(delta?.totalTokens ?? 0)),
  reasoningTokens:
    base.reasoningTokens + Math.max(0, Math.trunc(delta?.reasoningTokens ?? 0)),
  cachedInputTokens:
    base.cachedInputTokens +
    Math.max(0, Math.trunc(delta?.cachedInputTokens ?? 0)),
});

const INTERRUPTED_AI_CHAT_MESSAGE =
  "The previous AI response was interrupted before it finished.";

const truncateText = (value: string, maxChars: number) => {
  const text = String(value ?? "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 14))}…(truncated)`;
};

const calculateDurationMs = (createdAt: string, endedAtIso: string) => {
  const started = Date.parse(createdAt);
  const ended = Date.parse(endedAtIso);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return undefined;
  return Math.max(0, ended - started);
};

const settleInterruptedTimeline = (
  items: AiChatTimelineItem[],
  nowIso: string,
) => {
  let didInterrupt = false;

  const timeline = items.map((item) => {
    if (item.kind === "tool" && item.status === "running") {
      didInterrupt = true;
      return {
        ...item,
        status: "error" as const,
        resultSummary: item.resultSummary ?? INTERRUPTED_AI_CHAT_MESSAGE,
        progressDetails: undefined,
        progressItems: undefined,
        progressCounts: undefined,
        error: item.error ?? INTERRUPTED_AI_CHAT_MESSAGE,
      };
    }

    if (
      item.kind === "message" &&
      (item.role === "assistant" || item.role === "thinking") &&
      item.isStreaming
    ) {
      didInterrupt = true;
      return item.role === "thinking"
        ? {
            ...item,
            isStreaming: false,
            durationMs:
              item.durationMs ?? calculateDurationMs(item.createdAt, nowIso),
          }
        : {
            ...item,
            isStreaming: false,
          };
    }

    return item;
  });

  return {
    timeline,
    didInterrupt,
  };
};

export const canUseLocalStorage = () => {
  try {
    if (typeof window === "undefined") return false;
    if (!window.localStorage) return false;
    return true;
  } catch {
    return false;
  }
};

const buildPersistKey = (documentIdentity: string) =>
  `${AI_CHAT_PERSIST_KEY_PREFIX}${documentIdentity}`;

export const loadPersistedSelectedModelKey = () => {
  if (!canUseLocalStorage()) return undefined;
  try {
    const raw = window.localStorage.getItem(AI_CHAT_SELECTED_MODEL_KEY);
    return raw?.trim() || undefined;
  } catch {
    return undefined;
  }
};

export const persistSelectedModelKey = (selectedModelKey?: string) => {
  if (!canUseLocalStorage()) return;
  try {
    if (selectedModelKey) {
      window.localStorage.setItem(AI_CHAT_SELECTED_MODEL_KEY, selectedModelKey);
    } else {
      window.localStorage.removeItem(AI_CHAT_SELECTED_MODEL_KEY);
    }
  } catch {
    // ignore
  }
};

export const normalizeMessageAttachments = (
  attachments: AiChatMessageAttachment[] | undefined,
) => attachments?.map((attachment) => ({ ...attachment }));

const truncateMessageAttachments = (
  attachments: AiChatMessageAttachment[] | undefined,
) =>
  normalizeMessageAttachments(attachments)?.map((attachment) => {
    if (attachment.kind === "workspace_selection") {
      return {
        ...attachment,
        text: truncateText(attachment.text, 4_000),
      };
    }

    return {
      ...attachment,
      text:
        typeof attachment.text === "string"
          ? truncateText(attachment.text, 4_000)
          : undefined,
      highlightedText:
        typeof attachment.highlightedText === "string"
          ? truncateText(attachment.highlightedText, 4_000)
          : undefined,
      linkUrl:
        typeof attachment.linkUrl === "string"
          ? truncateText(attachment.linkUrl, 1_000)
          : undefined,
      stampLabel:
        typeof attachment.stampLabel === "string"
          ? truncateText(attachment.stampLabel, 1_000)
          : undefined,
    };
  });

const formatMessageAttachmentForConversation = (
  attachment: AiChatMessageAttachment,
  attachmentIndex: number,
) => {
  if (attachment.kind === "workspace_selection") {
    return [
      "SELECTION_ATTACHMENT",
      `attachment_index: ${attachmentIndex + 1}`,
      `page_number: ${attachment.pageIndex + 1}`,
      `start_offset: ${attachment.startOffset}`,
      `end_offset: ${attachment.endOffset}`,
      "text:",
      attachment.text,
    ].join("\n");
  }

  return [
    "ANNOTATION_ATTACHMENT",
    `attachment_index: ${attachmentIndex + 1}`,
    `annotation_id: ${attachment.annotationId}`,
    `annotation_type: ${attachment.annotationType}`,
    `page_number: ${attachment.pageIndex + 1}`,
    ...(attachment.highlightedText
      ? ["highlighted_text:", attachment.highlightedText]
      : []),
    ...(attachment.text ? ["annotation_text:", attachment.text] : []),
    ...(attachment.linkUrl ? [`link_url: ${attachment.linkUrl}`] : []),
    ...(typeof attachment.linkDestPageIndex === "number"
      ? [`link_dest_page_number: ${attachment.linkDestPageIndex + 1}`]
      : []),
    ...(attachment.stampKind ? [`stamp_kind: ${attachment.stampKind}`] : []),
    ...(attachment.stampPresetId
      ? [`stamp_preset_id: ${attachment.stampPresetId}`]
      : []),
    ...(attachment.stampLabel ? ["stamp_label:", attachment.stampLabel] : []),
    ...(attachment.stampHasImage ? ["stamp_has_image: true"] : []),
  ].join("\n");
};

export const buildConversationMessageContent = (
  text: string,
  attachments?: AiChatMessageAttachment[],
) => {
  const blocks = (normalizeMessageAttachments(attachments) ?? [])
    .map((attachment, index) =>
      formatMessageAttachmentForConversation(attachment, index),
    )
    .filter(Boolean);

  return [text.trim(), ...blocks].filter(Boolean).join("\n\n");
};

export const normalizeUserMessageInput = (input: AiChatUserMessageInput) => {
  if (typeof input === "string") {
    return {
      text: input,
      displayText: input,
      attachments: undefined,
    };
  }

  return {
    text: input.text,
    displayText: input.displayText ?? input.text,
    attachments: normalizeMessageAttachments(input.attachments),
    editContext: input.editContext,
  };
};

export const normalizeTimelineForPersist = (items: AiChatTimelineItem[]) => {
  const tail = items.slice(
    Math.max(0, items.length - MAX_PERSIST_TIMELINE_ITEMS),
  );
  return tail.map((item) => {
    if (item.kind === "message") {
      return {
        ...item,
        text: truncateText(item.text, MAX_PERSIST_MESSAGE_CHARS),
        conversationText:
          typeof item.conversationText === "string"
            ? truncateText(item.conversationText, MAX_PERSIST_MESSAGE_CHARS)
            : undefined,
        attachments: truncateMessageAttachments(item.attachments),
      };
    }

    return {
      ...item,
      argsText: truncateText(item.argsText, MAX_PERSIST_TOOL_ARGS_CHARS),
      resultSummary:
        typeof item.resultSummary === "string"
          ? truncateText(item.resultSummary, MAX_PERSIST_TOOL_SUMMARY_CHARS)
          : undefined,
      progressDetails: Array.isArray(item.progressDetails)
        ? item.progressDetails
            .slice(0, 16)
            .map((detail) => truncateText(detail, 200))
        : undefined,
      progressItems: Array.isArray(item.progressItems)
        ? item.progressItems.slice(0, 16).map((progressItem) => ({
            ...progressItem,
            label: truncateText(progressItem.label, 120),
          }))
        : undefined,
      progressCounts: item.progressCounts
        ? {
            pending: item.progressCounts.pending,
            running: item.progressCounts.running,
            done: item.progressCounts.done,
          }
        : undefined,
      resultText:
        typeof item.resultText === "string"
          ? truncateText(item.resultText, MAX_PERSIST_TOOL_RESULT_CHARS)
          : undefined,
      previewImages: undefined,
      error:
        typeof item.error === "string"
          ? truncateText(item.error, 8_000)
          : undefined,
    };
  });
};

export const restoreConversationFromTimeline = (
  items: AiChatTimelineItem[],
) => {
  const conversation: AiChatMessageRecord[] = [];
  let pendingAssistant:
    | {
        turnId: string;
        text: string;
      }
    | undefined;
  let pendingToolBatch:
    | {
        batchId: string;
        callParts: Array<{
          type: "tool-call";
          toolCallId: string;
          toolName: string;
          input: Record<string, unknown>;
        }>;
        resultParts: Array<{
          type: "tool-result";
          toolCallId: string;
          toolName: string;
          output: ToolResultOutput;
        }>;
      }
    | undefined;

  const parseToolArgs = (argsText: string) => {
    try {
      const parsed = JSON.parse(argsText);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  };

  const parseToolOutput = (
    item: Extract<AiChatTimelineItem, { kind: "tool" }>,
  ): ToolResultOutput | null => {
    const rawText =
      typeof item.resultText === "string" && item.resultText.trim()
        ? item.resultText.trim()
        : typeof item.error === "string" && item.error.trim()
          ? item.error.trim()
          : typeof item.resultSummary === "string" && item.resultSummary.trim()
            ? item.resultSummary.trim()
            : "";

    if (!rawText) return null;

    try {
      return {
        type: item.status === "error" ? "error-json" : "json",
        value: JSON.parse(rawText),
      };
    } catch {
      return {
        type: item.status === "error" ? "error-text" : "text",
        value: rawText,
      };
    }
  };

  const flushPendingAssistant = () => {
    if (!pendingAssistant) return;
    conversation.push({
      role: "assistant",
      content: pendingAssistant.text,
    });
    pendingAssistant = undefined;
  };

  const flushPendingToolBatch = () => {
    if (!pendingToolBatch) return;

    if (pendingToolBatch.callParts.length > 0) {
      conversation.push({
        role: "assistant",
        content: pendingToolBatch.callParts,
      });
    }

    if (pendingToolBatch.resultParts.length > 0) {
      conversation.push({
        role: "tool",
        content: pendingToolBatch.resultParts,
      });
    }

    pendingToolBatch = undefined;
  };

  for (const item of items) {
    if (item.kind === "message") {
      if (item.role === "thinking") continue;
      flushPendingToolBatch();
      if (item.role === "assistant") {
        const turnId = item.turnId ?? item.id;
        if (!pendingAssistant || pendingAssistant.turnId !== turnId) {
          flushPendingAssistant();
          pendingAssistant = {
            turnId,
            text: item.text,
          };
        } else {
          pendingAssistant.text += item.text;
        }
        continue;
      }

      flushPendingAssistant();
      conversation.push({
        role: item.role,
        content:
          item.role === "user"
            ? (item.conversationText ??
              buildConversationMessageContent(item.text, item.attachments))
            : item.text,
      });
      continue;
    }

    flushPendingAssistant();
    const toolOutput = parseToolOutput(item);
    if (!toolOutput) {
      flushPendingToolBatch();
      continue;
    }

    const batchId = item.batchId ?? item.toolCallId;
    if (!pendingToolBatch || pendingToolBatch.batchId !== batchId) {
      flushPendingToolBatch();
      pendingToolBatch = {
        batchId,
        callParts: [],
        resultParts: [],
      };
    }

    pendingToolBatch.callParts.push({
      type: "tool-call",
      toolCallId: item.toolCallId,
      toolName: item.toolName,
      input: parseToolArgs(item.argsText),
    });
    pendingToolBatch.resultParts.push({
      type: "tool-result",
      toolCallId: item.toolCallId,
      toolName: item.toolName,
      output: toolOutput,
    });
  }
  flushPendingToolBatch();
  flushPendingAssistant();
  return conversation;
};

export const getConversationMessageCountForTimelinePrefix = (
  items: AiChatTimelineItem[],
  timelineItemCount: number,
) =>
  restoreConversationFromTimeline(
    items.slice(0, Math.max(0, Math.trunc(timelineItemCount || 0))),
  ).length;

export const getLatestUserSelectionAttachmentsFromTimeline = (
  items: AiChatTimelineItem[],
) => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.kind !== "message" || item.role !== "user") continue;
    return (normalizeMessageAttachments(item.attachments) ?? []).flatMap(
      (attachment) =>
        attachment.kind === "workspace_selection" ? [attachment] : [],
    );
  }
  return [] as AiChatSelectionAttachment[];
};

export const toTitleSnippet = (text: string) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > 36 ? `${normalized.slice(0, 36)}…` : normalized;
};

export const stringifyToolPayload = (payload: unknown) => {
  try {
    const json = JSON.stringify(
      toSnakeCaseKeysDeep(omitEmptyArrayFieldsDeep(payload ?? null)),
      null,
      2,
    );
    if (typeof json === "string") return json;
  } catch {
    // ignore
  }
  try {
    return String(payload);
  } catch {
    return "";
  }
};

export const stringifyToolArgs = (args: Record<string, unknown>) => {
  try {
    const json = JSON.stringify(normalizeAiToolArgsDeep(args ?? {}), null, 2);
    if (typeof json === "string") return json;
  } catch {
    // ignore
  }
  return "{}";
};

export const createAiChatSessionId = () =>
  `ai_chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const createAiChatSessionData = (
  id: string,
  nowIso: string,
  branchMeta?: {
    parentSessionId?: string;
    branchDepth?: number;
    branchKind?: "edit" | "regenerate";
    branchSourceMessageId?: string;
    branchContextUserMessageId?: string;
    branchContextUserAnchorId?: string;
  },
): AiChatSessionData => ({
  id,
  title: "",
  updatedAt: nowIso,
  parentSessionId: branchMeta?.parentSessionId,
  branchDepth: branchMeta?.branchDepth ?? 0,
  branchKind: branchMeta?.branchKind,
  branchSourceMessageId: branchMeta?.branchSourceMessageId,
  branchContextUserMessageId: branchMeta?.branchContextUserMessageId,
  branchContextUserAnchorId: branchMeta?.branchContextUserAnchorId,
  timeline: [],
  conversation: [],
  searchResultsById: new Map(),
  highlightedResultIds: [],
  pendingDetectedFieldBatches: [],
  contextMemory: undefined,
  tokenUsage: createEmptyAiChatTokenUsageSummary(),
  contextTokens: 0,
  contextTokenOverhead: 0,
  runStatus: "idle",
  lastError: null,
  awaitingContinue: false,
});

export const restorePersistedAiChatDocumentState = (
  documentIdentity: string,
): RestoredAiChatDocumentState | null => {
  if (!canUseLocalStorage()) return null;

  const raw = window.localStorage.getItem(buildPersistKey(documentIdentity));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PersistedAiChatState;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.version !== AI_CHAT_PERSIST_VERSION ||
      !Array.isArray(parsed.sessions) ||
      typeof parsed.activeSessionId !== "string"
    ) {
      return null;
    }

    const sessionsMap = new Map<string, AiChatSessionData>();
    const sessionSummaries: AiChatSessionSummary[] = [];

    for (const session of parsed.sessions.slice(0, MAX_PERSIST_SESSIONS)) {
      if (!session || typeof session !== "object") continue;
      if (typeof session.id !== "string") continue;

      const title = typeof session.title === "string" ? session.title : "";
      const updatedAt =
        typeof session.updatedAt === "string"
          ? session.updatedAt
          : new Date().toISOString();
      const timelineRaw = Array.isArray(session.timeline)
        ? session.timeline
        : [];
      const normalizedTimeline = normalizeTimelineForPersist(timelineRaw);
      const { timeline } = settleInterruptedTimeline(
        normalizedTimeline,
        updatedAt,
      );

      const searchResultsList = Array.isArray(session.searchResults)
        ? session.searchResults.slice(
            Math.max(
              0,
              session.searchResults.length - MAX_PERSIST_SEARCH_RESULTS,
            ),
          )
        : [];
      const searchResultsById = new Map<string, AiStoredSearchResult>();
      for (const searchResult of searchResultsList) {
        if (!searchResult || typeof searchResult !== "object") continue;
        const id = (searchResult as { id?: unknown }).id;
        const query = (searchResult as { query?: unknown }).query;
        const result = (searchResult as { result?: unknown }).result;
        if (typeof id !== "string" || typeof query !== "string") continue;
        if (!result || typeof result !== "object") continue;
        searchResultsById.set(id, {
          id,
          query,
          result: result as PDFSearchResult,
        });
      }

      const highlightedResultIds = Array.isArray(session.highlightedResultIds)
        ? session.highlightedResultIds
            .map((value) => (typeof value === "string" ? value : ""))
            .filter(Boolean)
        : [];
      const pendingDetectedFieldBatches = Array.isArray(
        session.pendingDetectedFieldBatches,
      )
        ? (session.pendingDetectedFieldBatches
            .map((batch) => {
              if (!batch || typeof batch !== "object") return null;
              const batchId =
                typeof batch.batchId === "string" ? batch.batchId : "";
              if (!batchId) return null;

              const drafts = Array.isArray(batch.drafts)
                ? (batch.drafts
                    .map((draft) => {
                      if (!draft || typeof draft !== "object") return null;
                      const draftId =
                        typeof draft.draftId === "string" ? draft.draftId : "";
                      const field = (draft as { field?: unknown }).field;
                      const summary = (draft as { summary?: unknown }).summary;
                      if (
                        !draftId ||
                        !field ||
                        typeof field !== "object" ||
                        !summary ||
                        typeof summary !== "object"
                      ) {
                        return null;
                      }

                      return {
                        draftId,
                        field: field as FormField,
                        summary: summary as AiDetectedFormFieldDraft,
                      } satisfies AiDetectedFormFieldDraftState;
                    })
                    .filter(Boolean) as AiDetectedFormFieldDraftState[])
                : [];

              const pageNumbers = Array.isArray(batch.pageNumbers)
                ? batch.pageNumbers
                    .map((value) =>
                      typeof value === "number" && Number.isFinite(value)
                        ? Math.max(1, Math.trunc(value))
                        : 0,
                    )
                    .filter((value) => value > 0)
                : [];

              const allowedTypes = Array.isArray(batch.allowedTypes)
                ? (batch.allowedTypes
                    .map((value) => (typeof value === "string" ? value : ""))
                    .filter(Boolean) as AiFormFieldKind[])
                : undefined;

              return {
                batchId,
                createdAt:
                  typeof batch.createdAt === "string"
                    ? batch.createdAt
                    : updatedAt,
                status:
                  batch.status === "applied" || batch.status === "discarded"
                    ? batch.status
                    : "draft",
                pageNumbers,
                allowedTypes:
                  allowedTypes && allowedTypes.length > 0
                    ? allowedTypes
                    : undefined,
                userIntent:
                  typeof batch.userIntent === "string"
                    ? batch.userIntent
                    : undefined,
                extraPrompt:
                  typeof batch.extraPrompt === "string"
                    ? batch.extraPrompt
                    : undefined,
                confirmedAt:
                  typeof batch.confirmedAt === "string"
                    ? batch.confirmedAt
                    : undefined,
                confirmedByMessageId:
                  typeof batch.confirmedByMessageId === "string"
                    ? batch.confirmedByMessageId
                    : undefined,
                confirmedByUserText:
                  typeof batch.confirmedByUserText === "string"
                    ? batch.confirmedByUserText
                    : undefined,
                drafts,
              } satisfies AiDetectedFormFieldBatchState;
            })
            .filter(Boolean) as AiDetectedFormFieldBatchState[])
        : [];

      const nextSession: AiChatSessionData = {
        id: session.id,
        title,
        updatedAt,
        parentSessionId:
          typeof session.parentSessionId === "string"
            ? session.parentSessionId
            : undefined,
        branchDepth:
          typeof session.branchDepth === "number" &&
          Number.isFinite(session.branchDepth)
            ? Math.max(0, Math.trunc(session.branchDepth))
            : 0,
        branchKind:
          session.branchKind === "edit" || session.branchKind === "regenerate"
            ? session.branchKind
            : undefined,
        branchSourceMessageId:
          typeof session.branchSourceMessageId === "string"
            ? session.branchSourceMessageId
            : undefined,
        branchContextUserMessageId:
          typeof session.branchContextUserMessageId === "string"
            ? session.branchContextUserMessageId
            : undefined,
        branchContextUserAnchorId:
          typeof session.branchContextUserAnchorId === "string"
            ? session.branchContextUserAnchorId
            : undefined,
        timeline,
        conversation: restoreConversationFromTimeline(timeline),
        searchResultsById,
        highlightedResultIds,
        pendingDetectedFieldBatches,
        contextMemory:
          session.contextMemory &&
          typeof session.contextMemory === "object" &&
          typeof session.contextMemory.text === "string" &&
          session.contextMemory.text.trim() &&
          typeof session.contextMemory.coveredTimelineItemCount === "number" &&
          Number.isFinite(session.contextMemory.coveredTimelineItemCount) &&
          typeof session.contextMemory.coveredMessageCount === "number" &&
          Number.isFinite(session.contextMemory.coveredMessageCount)
            ? {
                text: session.contextMemory.text.trim(),
                coveredTimelineItemCount: Math.max(
                  0,
                  Math.trunc(session.contextMemory.coveredTimelineItemCount),
                ),
                coveredMessageCount: Math.max(
                  0,
                  Math.trunc(session.contextMemory.coveredMessageCount),
                ),
                updatedAt:
                  typeof session.contextMemory.updatedAt === "string"
                    ? session.contextMemory.updatedAt
                    : updatedAt,
              }
            : undefined,
        tokenUsage:
          session.tokenUsage && typeof session.tokenUsage === "object"
            ? {
                inputTokens: Math.max(
                  0,
                  Math.trunc(session.tokenUsage.inputTokens ?? 0),
                ),
                outputTokens: Math.max(
                  0,
                  Math.trunc(session.tokenUsage.outputTokens ?? 0),
                ),
                totalTokens: Math.max(
                  0,
                  Math.trunc(session.tokenUsage.totalTokens ?? 0),
                ),
                reasoningTokens: Math.max(
                  0,
                  Math.trunc(session.tokenUsage.reasoningTokens ?? 0),
                ),
                cachedInputTokens: Math.max(
                  0,
                  Math.trunc(session.tokenUsage.cachedInputTokens ?? 0),
                ),
              }
            : createEmptyAiChatTokenUsageSummary(),
        contextTokens: Math.max(0, Math.trunc(session.contextTokens ?? 0)),
        contextTokenOverhead: Math.max(
          0,
          Math.trunc(session.contextTokenOverhead ?? 0),
        ),
        runStatus: "idle",
        lastError:
          typeof session.lastError === "string" ? session.lastError : null,
        awaitingContinue: session.awaitingContinue === true,
      };

      sessionsMap.set(nextSession.id, nextSession);
      if (
        nextSession.contextMemory &&
        (nextSession.contextMemory.coveredTimelineItemCount >
          nextSession.timeline.length ||
          nextSession.contextMemory.coveredMessageCount >
            nextSession.conversation.length)
      ) {
        nextSession.contextMemory = undefined;
      }
      sessionSummaries.push({
        id: nextSession.id,
        title: nextSession.title,
        updatedAt: nextSession.updatedAt,
        parentSessionId: nextSession.parentSessionId,
        branchDepth: nextSession.branchDepth,
        branchKind: nextSession.branchKind,
        branchSourceMessageId: nextSession.branchSourceMessageId,
        branchContextUserMessageId: nextSession.branchContextUserMessageId,
        branchContextUserAnchorId: nextSession.branchContextUserAnchorId,
      });
    }

    if (sessionsMap.size === 0) return null;

    return {
      activeSessionId: sessionsMap.has(parsed.activeSessionId)
        ? parsed.activeSessionId
        : sessionSummaries[0]!.id,
      sessionsMap,
      sessionSummaries,
    };
  } catch {
    return null;
  }
};

export const persistAiChatDocumentState = (options: {
  documentIdentity: string;
  activeSessionId: string;
  sessions: AiChatSessionSummary[];
  sessionsMap: Map<string, AiChatSessionData>;
}) => {
  if (!canUseLocalStorage()) return;

  const key = buildPersistKey(options.documentIdentity);
  const persistedSessions: PersistedAiChatSession[] = options.sessions
    .slice(0, MAX_PERSIST_SESSIONS)
    .map((summary) => {
      const data = options.sessionsMap.get(summary.id);
      if (!data) {
        return {
          id: summary.id,
          title: summary.title ?? "",
          updatedAt: summary.updatedAt ?? new Date().toISOString(),
          parentSessionId: summary.parentSessionId,
          branchDepth: summary.branchDepth,
          branchKind: summary.branchKind,
          branchSourceMessageId: summary.branchSourceMessageId,
          branchContextUserMessageId: summary.branchContextUserMessageId,
          branchContextUserAnchorId: summary.branchContextUserAnchorId,
          timeline: [],
          searchResults: [],
          highlightedResultIds: [],
        };
      }

      const searchResultsList = Array.from(data.searchResultsById.values());
      const trimmedSearchResults = searchResultsList.slice(
        Math.max(0, searchResultsList.length - MAX_PERSIST_SEARCH_RESULTS),
      );

      return {
        id: data.id,
        title: data.title,
        updatedAt: data.updatedAt,
        parentSessionId: data.parentSessionId,
        branchDepth: data.branchDepth,
        branchKind: data.branchKind,
        branchSourceMessageId: data.branchSourceMessageId,
        branchContextUserMessageId: data.branchContextUserMessageId,
        branchContextUserAnchorId: data.branchContextUserAnchorId,
        timeline: normalizeTimelineForPersist(data.timeline),
        searchResults: trimmedSearchResults,
        highlightedResultIds: data.highlightedResultIds,
        pendingDetectedFieldBatches: data.pendingDetectedFieldBatches,
        contextMemory: data.contextMemory,
        tokenUsage: data.tokenUsage,
        contextTokens: data.contextTokens,
        contextTokenOverhead: data.contextTokenOverhead,
        lastError: data.lastError,
        awaitingContinue: data.awaitingContinue,
      };
    });

  const payload: PersistedAiChatState = {
    version: AI_CHAT_PERSIST_VERSION,
    activeSessionId: options.activeSessionId,
    sessions: persistedSessions,
  };

  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    try {
      const activeData = options.sessionsMap.get(options.activeSessionId);
      if (!activeData) return;
      const searchResultsList = Array.from(
        activeData.searchResultsById.values(),
      );
      const trimmedSearchResults = searchResultsList.slice(
        Math.max(
          0,
          searchResultsList.length - Math.min(200, MAX_PERSIST_SEARCH_RESULTS),
        ),
      );
      const minimal: PersistedAiChatState = {
        version: AI_CHAT_PERSIST_VERSION,
        activeSessionId: options.activeSessionId,
        sessions: [
          {
            id: activeData.id,
            title: activeData.title,
            updatedAt: activeData.updatedAt,
            parentSessionId: activeData.parentSessionId,
            branchDepth: activeData.branchDepth,
            branchKind: activeData.branchKind,
            branchSourceMessageId: activeData.branchSourceMessageId,
            branchContextUserMessageId: activeData.branchContextUserMessageId,
            branchContextUserAnchorId: activeData.branchContextUserAnchorId,
            timeline: normalizeTimelineForPersist(activeData.timeline),
            searchResults: trimmedSearchResults,
            highlightedResultIds: activeData.highlightedResultIds,
            pendingDetectedFieldBatches: activeData.pendingDetectedFieldBatches,
            contextMemory: activeData.contextMemory,
            tokenUsage: activeData.tokenUsage,
            contextTokens: activeData.contextTokens,
            contextTokenOverhead: activeData.contextTokenOverhead,
            lastError: activeData.lastError,
            awaitingContinue: activeData.awaitingContinue,
          },
        ],
      };
      window.localStorage.setItem(key, JSON.stringify(minimal));
    } catch {
      // ignore
    }
  }
};
