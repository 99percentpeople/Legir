import type {
  AiChatMessageRecord,
  AiChatTokenUsageSummary,
  AiChatTimelineItem,
  AiStoredSearchResult,
} from "@/services/ai/chat/types";

import {
  type AiChatRunStatus,
  type AiChatSessionData,
} from "@/hooks/useAiChatController/sessionPersistence";
import { getAiChatSessionUiState } from "@/hooks/useAiChatController/sessionActions";

type AiChatUiStateRefs = {
  conversationRef: { current: AiChatMessageRecord[] };
  searchResultsRef: { current: Map<string, AiStoredSearchResult> };
};

type AiChatUiStateSetters = {
  setTimeline: (timeline: AiChatTimelineItem[]) => void;
  setRunStatus: (status: AiChatRunStatus) => void;
  setLastError: (error: string | null) => void;
  setAwaitingContinue: (value: boolean) => void;
  setTokenUsage: (usage: AiChatTokenUsageSummary) => void;
  setContextTokens: (value: number) => void;
  setHighlightedResultIds: (ids: string[]) => void;
};

export const applyAiChatSessionUiState = (
  options: AiChatUiStateRefs &
    AiChatUiStateSetters & {
      session: AiChatSessionData;
    },
) => {
  const uiState = getAiChatSessionUiState(options.session);
  options.conversationRef.current = uiState.conversation;
  options.searchResultsRef.current = uiState.searchResultsById;
  options.setTimeline(uiState.timeline);
  options.setRunStatus(uiState.runStatus);
  options.setLastError(uiState.lastError);
  options.setAwaitingContinue(uiState.awaitingContinue);
  options.setTokenUsage(uiState.tokenUsage);
  options.setContextTokens(uiState.contextTokens);
  options.setHighlightedResultIds(uiState.highlightedResultIds);
};
