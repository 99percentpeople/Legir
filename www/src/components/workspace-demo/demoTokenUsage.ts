import type {
  AiChatMessageAttachment,
  AiChatTimelineItem,
} from "@/services/ai/chat/types";
import type { AiReasoningLevel } from "@/services/ai";
import type { DemoTokenPlan, DemoTokenStats } from "./types";

// Authored demo allowances, not a DeepSeek tokenizer, context limit or bill.
const DOCUMENT_AND_PROMPT_TOKENS = 1180;
const MESSAGE_OVERHEAD_TOKENS = 8;

/** A deterministic visual estimate that also grows with CJK text and emoji. */
export function estimateDemoTokens(text: string): number {
  if (!text.trim()) return 0;
  let units = 0;
  for (const character of text) {
    units += character.codePointAt(0)! > 127 ? 1 : 0.25;
  }
  return Math.ceil(units);
}

/** Snapshots travel with the local timeline, so history and branching stay coherent. */
export function getDemoTokenStats(
  timeline: AiChatTimelineItem[],
): DemoTokenStats {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item.tokenUsageSnapshot) {
      return {
        tokenUsage: { ...item.tokenUsageSnapshot },
        contextTokens: item.contextTokensSnapshot ?? 0,
      };
    }
  }
  return {
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reasoningTokens: 0,
      cachedInputTokens: 0,
    },
    contextTokens: 0,
  };
}

/** Capture the input once per request, not again on every streamed text update. */
export function createDemoTokenPlan(
  prefix: AiChatTimelineItem[],
  prompt: string,
  attachments: AiChatMessageAttachment[] = [],
  reasoning: AiReasoningLevel = "none",
): DemoTokenPlan {
  const previous = getDemoTokenStats(prefix);
  return {
    previousUsage: previous.tokenUsage,
    inputTokens:
      (previous.contextTokens || DOCUMENT_AND_PROMPT_TOKENS) +
      MESSAGE_OVERHEAD_TOKENS +
      estimateDemoTokens(prompt) +
      attachments.reduce(
        (tokens, attachment) =>
          tokens +
          MESSAGE_OVERHEAD_TOKENS +
          estimateDemoTokens(
            attachment.kind === "workspace_selection"
              ? attachment.text
              : [attachment.text, attachment.highlightedText]
                  .filter(Boolean)
                  .join("\n"),
          ),
        0,
      ),
    reasoning: reasoning !== "none",
  };
}

/** Output follows the text actually displayed: stopping never credits a full answer. */
export function simulateDemoTokenStats(
  plan: DemoTokenPlan,
  visibleText: string,
): DemoTokenStats {
  const visibleOutputTokens = estimateDemoTokens(visibleText);
  const reasoningTokens = plan.reasoning
    ? Math.floor(visibleOutputTokens / 3)
    : 0;
  const inputTokens = plan.previousUsage.inputTokens + plan.inputTokens;
  // Reasoning is a subset of output, not an extra amount added to total twice.
  const outputTokens =
    plan.previousUsage.outputTokens + visibleOutputTokens + reasoningTokens;
  return {
    tokenUsage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      reasoningTokens: plan.previousUsage.reasoningTokens + reasoningTokens,
      cachedInputTokens: plan.previousUsage.cachedInputTokens,
    },
    // Context describes the retained conversation, not cumulative request usage.
    contextTokens: plan.inputTokens + visibleOutputTokens,
  };
}
