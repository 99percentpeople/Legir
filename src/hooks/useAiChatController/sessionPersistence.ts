import {
  normalizeAiToolArgsDeep,
  toSnakeCaseKeysDeep,
} from "@/services/ai/utils/toolCase";
import { omitEmptyArrayFieldsDeep } from "@/services/ai/utils/json";
import type {
  AiChatMessageAttachment,
  AiChatMessageRecord,
  AiChatSelectionAttachment,
  AiChatSessionSummary,
  AiChatTimelineItem,
  AiChatUserMessageInput,
  AiStoredSearchResult,
} from "@/services/ai/chat/types";
import type { PDFSearchResult } from "@/types";

export type AiChatRunStatus = "idle" | "running" | "cancelling" | "error";

export const AI_CHAT_SELECTED_MODEL_KEY = "ff-ai-chat:selected-model";

const AI_CHAT_PERSIST_VERSION = 1;
const AI_CHAT_PERSIST_KEY_PREFIX = "ff-ai-chat:";
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
  runStatus: AiChatRunStatus;
  lastError: string | null;
};

export type RestoredAiChatDocumentState = {
  activeSessionId: string;
  sessionsMap: Map<string, AiChatSessionData>;
  sessionSummaries: AiChatSessionSummary[];
};

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
    if (attachment.kind !== "workspace_selection") return attachment;
    return {
      ...attachment,
      text: truncateText(attachment.text, 4_000),
    };
  });

const formatMessageAttachmentForConversation = (
  attachment: AiChatMessageAttachment,
  attachmentIndex: number,
) => {
  if (attachment.kind !== "workspace_selection") return "";

  return [
    "SELECTION_ATTACHMENT",
    `attachment_index: ${attachmentIndex + 1}`,
    `page_number: ${attachment.pageIndex + 1}`,
    `start_offset: ${attachment.startOffset}`,
    `end_offset: ${attachment.endOffset}`,
    "text:",
    attachment.text,
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

  const flushPendingAssistant = () => {
    if (!pendingAssistant) return;
    conversation.push({
      role: "assistant",
      content: pendingAssistant.text,
    });
    pendingAssistant = undefined;
  };

  for (const item of items) {
    if (item.kind === "message") {
      if (item.role === "thinking") continue;
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

    if (
      item.resultText &&
      (item.status === "done" || item.status === "error")
    ) {
      conversation.push({
        role: "tool",
        content: [
          "TOOL_RESULT",
          `name: ${item.toolName}`,
          `arguments: ${item.argsText}`,
          `result: ${item.resultText}`,
        ].join("\n"),
        toolCallId: item.toolCallId,
        toolName: item.toolName,
      });
    }
  }
  flushPendingAssistant();
  return conversation;
};

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
  runStatus: "idle",
  lastError: null,
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
        runStatus: "idle",
        lastError: null,
      };

      sessionsMap.set(nextSession.id, nextSession);
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
          },
        ],
      };
      window.localStorage.setItem(key, JSON.stringify(minimal));
    } catch {
      // ignore
    }
  }
};
