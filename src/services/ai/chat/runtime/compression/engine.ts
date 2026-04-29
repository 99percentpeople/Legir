import {
  aiContextCompressionStrategy,
  algorithmicContextCompressionStrategy,
  contextMemoryMessageCompressionStrategy,
  visualHistoryMessageCompressionStrategy,
} from "@/services/ai/chat/runtime/compression/strategies";
import type {
  AiChatCompressionPhase,
  AiChatCompressionStrategySet,
  AiChatMessageCompressionOptions,
  AiChatProjectedTokenEstimator,
  AiChatTimelineItemCounter,
  AiChatTurnCompressionOptions,
  AiChatTurnCompressionSessionSnapshot,
} from "@/services/ai/chat/runtime/compression/types";

const DEFAULT_AI_CHAT_COMPRESSION_STRATEGIES: AiChatCompressionStrategySet = {
  messageStrategies: [
    contextMemoryMessageCompressionStrategy,
    visualHistoryMessageCompressionStrategy,
  ],
  algorithmicStrategy: algorithmicContextCompressionStrategy,
  aiStrategy: aiContextCompressionStrategy,
};

/**
 * Central compression orchestrator.
 *
 * The engine owns strategy ordering and exposes a very small surface to the
 * rest of the app. Future compression work should usually add or swap
 * strategies here instead of threading new conditionals through controllers.
 */
export const createAiChatCompressionEngine = (
  overrides?: Partial<AiChatCompressionStrategySet>,
) => {
  const strategySet: AiChatCompressionStrategySet = {
    messageStrategies:
      overrides?.messageStrategies ??
      DEFAULT_AI_CHAT_COMPRESSION_STRATEGIES.messageStrategies,
    algorithmicStrategy:
      overrides?.algorithmicStrategy ??
      DEFAULT_AI_CHAT_COMPRESSION_STRATEGIES.algorithmicStrategy,
    aiStrategy:
      overrides?.aiStrategy ??
      DEFAULT_AI_CHAT_COMPRESSION_STRATEGIES.aiStrategy,
  };

  const prepareMessagesSync = (
    phase: AiChatCompressionPhase,
    options: AiChatMessageCompressionOptions,
  ) => {
    let nextMessages = options.messages;

    for (const strategy of strategySet.messageStrategies) {
      if (!strategy.phases.includes(phase)) continue;
      const result = strategy.apply({
        ...options,
        messages: nextMessages,
      });
      if (
        result &&
        typeof result === "object" &&
        "then" in result &&
        typeof result.then === "function"
      ) {
        throw new Error(
          `Compression strategy "${strategy.id}" must stay synchronous in projected mode.`,
        );
      }
      nextMessages = result as typeof nextMessages;
    }

    return nextMessages;
  };

  const prepareMessagesAsync = async (
    phase: AiChatCompressionPhase,
    options: AiChatMessageCompressionOptions,
  ) => {
    let nextMessages = options.messages;

    for (const strategy of strategySet.messageStrategies) {
      if (!strategy.phases.includes(phase)) continue;
      nextMessages = await strategy.apply({
        ...options,
        messages: nextMessages,
      });
    }

    return nextMessages;
  };

  return {
    /**
     * Applies the lightweight, deterministic message transforms used for token
     * estimation and pre-flight projections.
     */
    prepareProjectedMessages: (options: AiChatMessageCompressionOptions) =>
      prepareMessagesSync("projected", options),

    /**
     * Applies the full runtime transform chain before the model sees the next
     * step, including heavier image-history compression.
     */
    prepareRuntimeMessages: (options: AiChatMessageCompressionOptions) =>
      prepareMessagesAsync("runtime", options),

    /**
     * Builds the immediate algorithmic memory result for turn-end compression.
     */
    buildAlgorithmicContextMemory: (options: {
      session: AiChatTurnCompressionSessionSnapshot;
      aiChatOptions: AiChatTurnCompressionOptions;
      estimateProjectedTokens: AiChatProjectedTokenEstimator;
      getTimelineItemCountForConversationMessageCount: AiChatTimelineItemCounter;
    }) => strategySet.algorithmicStrategy.build(options),

    /**
     * Builds the AI-memory source plan that a background summarization model
     * can consume after the turn finishes.
     */
    buildAiContextMemoryPlan: (options: {
      session: AiChatTurnCompressionSessionSnapshot;
      aiChatOptions: AiChatTurnCompressionOptions;
      getTimelineItemCountForConversationMessageCount?: AiChatTimelineItemCounter;
    }) =>
      strategySet.aiStrategy.build({
        ...options,
        estimateProjectedTokens: () => 0,
        getTimelineItemCountForConversationMessageCount:
          options.getTimelineItemCountForConversationMessageCount ??
          ((timelineItems, conversationMessageCount) => {
            if (conversationMessageCount <= 0) return 0;
            if (
              conversationMessageCount >= options.session.conversation.length
            ) {
              return timelineItems.length;
            }
            return Math.min(
              options.session.contextMemory?.coveredTimelineItemCount ?? 0,
              timelineItems.length,
            );
          }),
      }),
  };
};

export const defaultAiChatCompressionEngine = createAiChatCompressionEngine();
