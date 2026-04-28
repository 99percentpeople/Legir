import type {
  AiChatContextMemory,
  AiChatMessageRecord,
  AiChatTimelineItem,
} from "@/services/ai/chat/types";
import type { AiChatContextMemoryPlan } from "@/services/ai/chat/runtime/contextMemory";
import type { AppOptions } from "@/types";

export type AiChatCompressionPhase = "projected" | "runtime";

export type AiChatMessageCompressionOptions = {
  messages: AiChatMessageRecord[];
  turnStartMessageCount: number;
  aiChatOptions: Pick<
    AppOptions["aiChat"],
    "contextCompressionEnabled" | "visualHistoryWindow"
  >;
  contextMemory?: AiChatContextMemory;
  requiresToolCallReasoningReplay?: boolean;
};

/**
 * A pluggable message transform that can compress or rewrite the exact
 * `ModelMessage[]` payload sent to the model.
 *
 * Strategies are intentionally narrow: they receive immutable inputs and return
 * a new message list without mutating session state. This keeps the runtime
 * pipeline easy to swap or extend later.
 */
export interface AiChatMessageCompressionStrategy {
  id: string;
  phases: readonly AiChatCompressionPhase[];
  apply(
    options: AiChatMessageCompressionOptions,
  ): Promise<AiChatMessageRecord[]> | AiChatMessageRecord[];
}

export type AiChatTurnCompressionSessionSnapshot = {
  conversation: AiChatMessageRecord[];
  timeline: AiChatTimelineItem[];
  contextMemory?: AiChatContextMemory;
  contextTokens: number;
  contextTokenOverhead: number;
};

export type AiChatTurnCompressionOptions = Pick<
  AppOptions["aiChat"],
  | "contextCompressionEnabled"
  | "contextCompressionThresholdTokens"
  | "visualHistoryWindow"
  | "contextCompressionMode"
>;

export type AiChatProjectedTokenEstimator = (
  contextMemory?: AiChatContextMemory,
) => number;

export type AiChatTimelineItemCounter = (
  timelineItems: AiChatTimelineItem[],
  conversationMessageCount: number,
) => number;

/**
 * A pluggable turn-end compression strategy.
 *
 * Turn strategies examine the immutable session snapshot after a response
 * finishes and decide what long-lived compression artifact should be produced.
 * Today that artifact is either an immediate `contextMemory` object or an
 * AI-generated memory plan, but the interface leaves room for future outputs.
 */
export interface AiChatTurnCompressionStrategy<TResult> {
  id: string;
  mode: AppOptions["aiChat"]["contextCompressionMode"];
  build(options: {
    session: AiChatTurnCompressionSessionSnapshot;
    aiChatOptions: AiChatTurnCompressionOptions;
    estimateProjectedTokens: AiChatProjectedTokenEstimator;
    getTimelineItemCountForConversationMessageCount: AiChatTimelineItemCounter;
  }): TResult;
}

export type AiChatCompressionStrategySet = {
  messageStrategies: readonly AiChatMessageCompressionStrategy[];
  algorithmicStrategy: AiChatTurnCompressionStrategy<
    AiChatContextMemory | undefined
  >;
  aiStrategy: AiChatTurnCompressionStrategy<AiChatContextMemoryPlan | null>;
};
