import type {
  AiChatMessageRecord,
  AiChatTokenUsageSummary,
  AiChatSessionSummary,
  AiChatTimelineItem,
  AiStoredSearchResult,
} from "@/services/ai/chat/types";

import {
  createEmptyAiChatTokenUsageSummary,
  createAiChatSessionData,
  createAiChatSessionId,
  type AiChatRunStatus,
  type AiChatSessionData,
} from "@/hooks/useAiChatController/sessionPersistence";

export type AiChatSessionUiState = {
  timeline: AiChatTimelineItem[];
  runStatus: AiChatRunStatus;
  lastError: string | null;
  awaitingContinue: boolean;
  tokenUsage: AiChatTokenUsageSummary;
  contextTokens: number;
  highlightedResultIds: string[];
  conversation: AiChatMessageRecord[];
  searchResultsById: Map<string, AiStoredSearchResult>;
};

export const getAiChatSessionUiState = (
  session: AiChatSessionData,
): AiChatSessionUiState => ({
  timeline: session.timeline,
  runStatus: session.runStatus,
  lastError: session.lastError,
  awaitingContinue: session.awaitingContinue,
  tokenUsage: session.tokenUsage,
  contextTokens: session.contextTokens,
  highlightedResultIds: session.highlightedResultIds,
  conversation: session.conversation,
  searchResultsById: session.searchResultsById,
});

export const getIdleAiChatSessionUiState = (): Omit<
  AiChatSessionUiState,
  "conversation" | "searchResultsById"
> => ({
  timeline: [],
  runStatus: "idle",
  lastError: null,
  awaitingContinue: false,
  tokenUsage: createEmptyAiChatTokenUsageSummary(),
  contextTokens: 0,
  highlightedResultIds: [],
});

export const createFreshAiChatSessionBundle = (nowIso: string) => {
  const id = createAiChatSessionId();
  const session = createAiChatSessionData(id, nowIso);
  const summary: AiChatSessionSummary = {
    id,
    title: "",
    updatedAt: nowIso,
    branchDepth: 0,
  };

  return {
    id,
    session,
    summary,
  };
};

export type DeleteConversationPlan =
  | { type: "noop" }
  | {
      type: "remove_non_active";
      deletedSessionIds: string[];
      nextSummaries: AiChatSessionSummary[];
    }
  | {
      type: "activate_existing";
      deletedSessionIds: string[];
      nextSummaries: AiChatSessionSummary[];
      nextActiveSessionId: string;
    }
  | {
      type: "create_replacement";
      deletedSessionIds: string[];
      nextSummaries: AiChatSessionSummary[];
      nextActiveSessionId: string;
      nextSession: AiChatSessionData;
    };

export const buildDeleteConversationPlan = (options: {
  sessions: AiChatSessionSummary[];
  activeSessionId: string;
  deleteSessionId: string;
  nowIso: string;
}): DeleteConversationPlan => {
  const sessionById = new Map(
    options.sessions.map((session) => [session.id, session]),
  );
  if (!sessionById.has(options.deleteSessionId)) return { type: "noop" };

  const childrenByParentId = new Map<string, string[]>();
  for (const session of options.sessions) {
    if (!session.parentSessionId) continue;
    const children = childrenByParentId.get(session.parentSessionId) ?? [];
    children.push(session.id);
    childrenByParentId.set(session.parentSessionId, children);
  }

  const deletedSessionIds: string[] = [];
  const stack = [options.deleteSessionId];
  while (stack.length > 0) {
    const sessionId = stack.pop()!;
    deletedSessionIds.push(sessionId);
    for (const childId of childrenByParentId.get(sessionId) ?? []) {
      stack.push(childId);
    }
  }

  const deletedIdSet = new Set(deletedSessionIds);
  const deletingActive = deletedIdSet.has(options.activeSessionId);
  const remaining = options.sessions.filter(
    (session) => !deletedIdSet.has(session.id),
  );

  if (!deletingActive) {
    return {
      type: "remove_non_active",
      deletedSessionIds,
      nextSummaries: remaining,
    };
  }
  if (remaining.length > 0) {
    return {
      type: "activate_existing",
      deletedSessionIds,
      nextSummaries: remaining,
      nextActiveSessionId: remaining[0]!.id,
    };
  }

  const replacement = createFreshAiChatSessionBundle(options.nowIso);
  return {
    type: "create_replacement",
    deletedSessionIds,
    nextSummaries: [replacement.summary],
    nextActiveSessionId: replacement.id,
    nextSession: replacement.session,
  };
};
