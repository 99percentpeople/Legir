import { compressVisualToolHistoryForModel } from "@/services/ai/chat/runtime/imageCompression";
import {
  applyAiChatContextMemoryToMessages,
  buildAiChatAlgorithmicMemoryText,
  countAiChatHeavyVisualToolMessages,
  getAiChatContextMemoryPlan,
} from "@/services/ai/chat/runtime/contextMemory";
import type {
  AiChatProjectedTokenEstimator,
  AiChatMessageCompressionStrategy,
  AiChatTimelineItemCounter,
  AiChatTurnCompressionStrategy,
  AiChatTurnCompressionOptions,
  AiChatTurnCompressionSessionSnapshot,
} from "@/services/ai/chat/runtime/compression/types";

/**
 * Replaces the already-compressed conversation prefix with the persisted
 * `contextMemory` system message. This runs before any heavier runtime-only
 * compression so downstream strategies see the same logical prompt shape that
 * the model will receive.
 */
export const contextMemoryMessageCompressionStrategy: AiChatMessageCompressionStrategy =
  {
    id: "context-memory",
    phases: ["projected", "runtime"],
    apply: (options) =>
      options.aiChatOptions.contextCompressionEnabled
        ? applyAiChatContextMemoryToMessages({
            messages: options.messages,
            contextMemory: options.contextMemory,
            turnStartMessageCount: options.turnStartMessageCount,
          })
        : options.messages,
  };

/**
 * Ages out older visual tool results during agent loops. This keeps step-level
 * image history cheap without deleting the most recent visual context.
 */
export const visualHistoryMessageCompressionStrategy: AiChatMessageCompressionStrategy =
  {
    id: "visual-history",
    phases: ["runtime"],
    apply: async (options) =>
      await compressVisualToolHistoryForModel({
        messages: options.messages,
        keepWindow: options.aiChatOptions.visualHistoryWindow,
      }),
  };

/**
 * Pure heuristic compressor that rewrites the oldest conversation prefix into a
 * short memory block. It aims for roughly half of the current context size
 * while preserving the beginning of the conversation and the latest conclusion.
 */
export const algorithmicContextCompressionStrategy: AiChatTurnCompressionStrategy<
  ReturnType<typeof buildAlgorithmicContextMemory>
> = {
  id: "algorithmic-context-memory",
  mode: "algorithmic",
  build: ({
    session,
    aiChatOptions,
    estimateProjectedTokens,
    getTimelineItemCountForConversationMessageCount,
  }) =>
    buildAlgorithmicContextMemory({
      session,
      aiChatOptions,
      estimateProjectedTokens,
      getTimelineItemCountForConversationMessageCount,
    }),
};

/**
 * AI-assisted compressor that packages the not-yet-compressed tail of the
 * conversation into a source payload for a background summarization model.
 */
export const aiContextCompressionStrategy: AiChatTurnCompressionStrategy<
  ReturnType<typeof getAiChatContextMemoryPlan>
> = {
  id: "ai-context-memory",
  mode: "ai",
  build: ({ session, aiChatOptions }) =>
    getAiChatContextMemoryPlan({
      timeline: session.timeline,
      conversation: session.conversation,
      contextMemory: session.contextMemory,
      aiChatOptions,
      contextTokens: session.contextTokens,
    }),
};

const buildAlgorithmicContextMemory = (options: {
  session: AiChatTurnCompressionSessionSnapshot;
  aiChatOptions: AiChatTurnCompressionOptions;
  estimateProjectedTokens: AiChatProjectedTokenEstimator;
  getTimelineItemCountForConversationMessageCount: AiChatTimelineItemCounter;
}) => {
  const {
    session,
    aiChatOptions,
    estimateProjectedTokens,
    getTimelineItemCountForConversationMessageCount,
  } = options;

  if (
    !aiChatOptions.contextCompressionEnabled ||
    aiChatOptions.contextCompressionMode !== "algorithmic"
  ) {
    return undefined;
  }

  const threshold = Math.max(
    0,
    Math.trunc(aiChatOptions.contextCompressionThresholdTokens || 0),
  );
  if (session.contextTokens < threshold || session.conversation.length === 0) {
    return undefined;
  }

  const targetTokens = Math.max(1, Math.floor(session.contextTokens / 2));
  const conversationLength = session.conversation.length;
  const visualWindow = Math.max(
    0,
    Math.trunc(aiChatOptions.visualHistoryWindow || 0),
  );

  let bestPlan:
    | {
        memoryText: string;
        coveredMessageCount: number;
        estimatedTokens: number;
      }
    | undefined;

  for (
    let keepSuffixCount = conversationLength;
    keepSuffixCount >= 0;
    keepSuffixCount -= 1
  ) {
    const coveredMessageCount = conversationLength - keepSuffixCount;
    if (coveredMessageCount <= 0) continue;

    const prefixMessages = session.conversation.slice(0, coveredMessageCount);
    const suffixMessages = session.conversation.slice(coveredMessageCount);

    if (countAiChatHeavyVisualToolMessages(suffixMessages) > visualWindow) {
      continue;
    }

    const memoryText = buildAiChatAlgorithmicMemoryText(prefixMessages);
    if (!memoryText) continue;

    const estimatedTokens = estimateProjectedTokens({
      text: memoryText,
      coveredMessageCount,
      coveredTimelineItemCount: getTimelineItemCountForConversationMessageCount(
        session.timeline,
        coveredMessageCount,
      ),
      updatedAt: session.contextMemory?.updatedAt ?? new Date().toISOString(),
    });

    if (!bestPlan || estimatedTokens < bestPlan.estimatedTokens) {
      bestPlan = {
        memoryText,
        coveredMessageCount,
        estimatedTokens,
      };
    }

    if (estimatedTokens <= targetTokens) {
      break;
    }
  }

  if (
    !bestPlan ||
    bestPlan.coveredMessageCount <= 0 ||
    bestPlan.estimatedTokens >= session.contextTokens
  ) {
    return undefined;
  }

  return {
    text: bestPlan.memoryText,
    coveredMessageCount: bestPlan.coveredMessageCount,
    coveredTimelineItemCount: getTimelineItemCountForConversationMessageCount(
      session.timeline,
      bestPlan.coveredMessageCount,
    ),
    updatedAt: new Date().toISOString(),
  };
};
