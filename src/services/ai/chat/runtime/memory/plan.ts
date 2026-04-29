import type {
  AiChatContextMemory,
  AiChatMessageRecord,
  AiChatTimelineItem,
} from "@/services/ai/chat/types";
import type { AppOptions } from "@/types";
import type { AiChatTimelineItemCounter } from "@/services/ai/chat/runtime/compression/types";
import {
  buildAiChatCompressionSegments,
  getAiChatCompressionSegmentEndAtOrBefore,
  getLastAiChatCompressionSegmentEnd,
} from "@/services/ai/chat/runtime/compression/segments";
import {
  getContextMemorySourceLines,
  truncateAiChatContextMemorySource,
} from "@/services/ai/chat/runtime/memory/source";

export type AiChatContextMemoryPlan = {
  sourceText: string;
  candidateCoveredTimelineItemCount: number;
  candidateCoveredMessageCount: number;
  alreadyCoveredTimelineItemCount: number;
  alreadyCoveredMessageCount: number;
};

const getTimelineItemCountForMessageCount = (options: {
  timeline: AiChatTimelineItem[];
  conversationLength: number;
  contextMemory?: AiChatContextMemory;
  messageCount: number;
  counter?: AiChatTimelineItemCounter;
}) => {
  const { counter, timeline, messageCount } = options;
  if (counter) {
    return counter(timeline, messageCount);
  }
  if (messageCount >= options.conversationLength) {
    return timeline.length;
  }
  if (messageCount <= 0) {
    return 0;
  }
  return Math.min(
    options.contextMemory?.coveredTimelineItemCount ?? 0,
    timeline.length,
  );
};

export const getAiChatContextMemoryPlan = (options: {
  timeline: AiChatTimelineItem[];
  conversation: AiChatMessageRecord[];
  contextMemory?: AiChatContextMemory;
  aiChatOptions: Pick<
    AppOptions["aiChat"],
    | "contextCompressionEnabled"
    | "contextCompressionMode"
    | "contextCompressionThresholdTokens"
  >;
  contextTokens: number;
  getTimelineItemCountForConversationMessageCount?: AiChatTimelineItemCounter;
}): AiChatContextMemoryPlan | null => {
  if (!options.aiChatOptions.contextCompressionEnabled) return null;
  if (options.aiChatOptions.contextCompressionMode !== "ai") return null;

  const segments = buildAiChatCompressionSegments(options.conversation);
  const candidateCoveredMessageCount =
    getLastAiChatCompressionSegmentEnd(segments);
  const alreadyCoveredMessageCount = getAiChatCompressionSegmentEndAtOrBefore(
    segments,
    Math.min(
      options.contextMemory?.coveredMessageCount ?? 0,
      candidateCoveredMessageCount,
    ),
  );
  const candidateCoveredTimelineItemCount = getTimelineItemCountForMessageCount(
    {
      timeline: options.timeline,
      conversationLength: options.conversation.length,
      contextMemory: options.contextMemory,
      messageCount: candidateCoveredMessageCount,
      counter: options.getTimelineItemCountForConversationMessageCount,
    },
  );
  const alreadyCoveredTimelineItemCount = getTimelineItemCountForMessageCount({
    timeline: options.timeline,
    conversationLength: options.conversation.length,
    contextMemory: options.contextMemory,
    messageCount: alreadyCoveredMessageCount,
    counter: options.getTimelineItemCountForConversationMessageCount,
  });

  if (
    candidateCoveredTimelineItemCount <= 0 ||
    candidateCoveredMessageCount <= 0
  ) {
    return null;
  }
  if (
    candidateCoveredTimelineItemCount <= alreadyCoveredTimelineItemCount ||
    candidateCoveredMessageCount <= alreadyCoveredMessageCount
  ) {
    return null;
  }

  if (
    options.contextTokens <
    Math.max(
      0,
      Math.trunc(options.aiChatOptions.contextCompressionThresholdTokens || 0),
    )
  ) {
    return null;
  }

  const sourceMessages = options.conversation.slice(
    alreadyCoveredMessageCount,
    candidateCoveredMessageCount,
  );
  const sourceText = truncateAiChatContextMemorySource(
    getContextMemorySourceLines(sourceMessages),
  );
  if (!sourceText) return null;

  return {
    sourceText,
    candidateCoveredTimelineItemCount,
    candidateCoveredMessageCount,
    alreadyCoveredTimelineItemCount,
    alreadyCoveredMessageCount,
  };
};
