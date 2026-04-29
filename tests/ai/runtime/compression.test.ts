import { describe, expect, test } from "vitest";

import { buildAiChatCompressionSegments } from "@/services/ai/chat/runtime/compression/segments";
import { createDefaultAiChatCompressionPolicy } from "@/services/ai/chat/runtime/compression/types";
import { algorithmicContextCompressionStrategy } from "@/services/ai/chat/runtime/compression/strategies";
import { applyAiChatContextMemoryToMessages } from "@/services/ai/chat/runtime/memory/apply";
import { getAiChatContextMemoryPlan } from "@/services/ai/chat/runtime/memory/plan";
import {
  buildAiChatContextMemoryMessage,
  getAiChatConversationMemoryCoveredMessageCount,
} from "@/services/ai/chat/runtime/memory/serialization";
import { deepseekRuntimeProfile } from "@/services/ai/providers/runtimeProfiles/deepseek";
import type {
  AiChatContextMemory,
  AiChatMessageRecord,
} from "@/services/ai/chat/types";

const nowIso = "2026-04-28T00:00:00.000Z";

const createMemory = (coveredMessageCount: number): AiChatContextMemory => ({
  text: "Earlier summary.",
  coveredMessageCount,
  coveredTimelineItemCount: coveredMessageCount,
  updatedAt: nowIso,
});

const createToolTurnMessages = (options?: {
  withReasoning?: boolean;
}): AiChatMessageRecord[] =>
  [
    { role: "user", content: "Read page 1." },
    {
      role: "assistant",
      content: [
        ...(options?.withReasoning
          ? [{ type: "reasoning", text: "I should inspect the page." }]
          : []),
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "get_pages_text",
          input: { page_numbers: [1] },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_1",
          toolName: "get_pages_text",
          output: { summary: "Found invoice total.", page_count: 1 },
        },
      ],
    },
  ] as AiChatMessageRecord[];

const hasAssistantToolCallWithoutReasoning = (message: AiChatMessageRecord) => {
  if (message.role !== "assistant" || !Array.isArray(message.content)) {
    return false;
  }
  const hasToolCall = message.content.some((part) => part.type === "tool-call");
  const hasReasoning = message.content.some(
    (part) =>
      part.type === "reasoning" &&
      typeof part.text === "string" &&
      !!part.text.trim(),
  );
  return hasToolCall && !hasReasoning;
};

describe("AI chat compression segments", () => {
  test("groups memory and complete turns with traits", () => {
    const messages = [
      buildAiChatContextMemoryMessage(createMemory(2)),
      ...createToolTurnMessages({ withReasoning: true }),
      { role: "user", content: "What changed?" },
      { role: "assistant", content: "The total was identified." },
    ] as AiChatMessageRecord[];

    const segments = buildAiChatCompressionSegments(messages);

    expect(segments.map((segment) => segment.kind)).toEqual([
      "memory",
      "turn",
      "turn",
    ]);
    expect(segments.map((segment) => segment.endMessageIndexExclusive)).toEqual(
      [1, 4, 6],
    );
    expect(segments[1]?.traits).toMatchObject({
      hasToolCall: true,
      hasToolResult: true,
      hasReasoning: true,
      hasAssistantToolCallWithoutReasoning: false,
    });
  });
});

describe("AI chat context memory application", () => {
  test("folds unsafe old assistant tool calls into memory for DeepSeek replay", () => {
    const messages = [
      ...createToolTurnMessages(),
      { role: "user", content: "Continue from there." },
    ] as AiChatMessageRecord[];

    const prepared = applyAiChatContextMemoryToMessages({
      messages,
      contextMemory: createMemory(1),
      policy: createDefaultAiChatCompressionPolicy({
        reasoningReplayPolicy: "tool-calls",
        turnStartMessageCount: messages.length,
        visualHistoryWindow: 4,
      }),
    });

    expect(getAiChatConversationMemoryCoveredMessageCount(prepared[0]!)).toBe(
      3,
    );
    expect(prepared.some(hasAssistantToolCallWithoutReasoning)).toBe(false);
    expect(() =>
      deepseekRuntimeProfile.validateMessages?.(prepared, {
        reasoning: { replayPolicy: "tool-calls" },
      } as Parameters<
        NonNullable<typeof deepseekRuntimeProfile.validateMessages>
      >[1]),
    ).not.toThrow();
  });

  test("keeps assistant tool calls with reasoning in the suffix", () => {
    const messages = [
      ...createToolTurnMessages({ withReasoning: true }),
      { role: "user", content: "Continue from there." },
    ] as AiChatMessageRecord[];

    const prepared = applyAiChatContextMemoryToMessages({
      messages,
      contextMemory: createMemory(1),
      policy: createDefaultAiChatCompressionPolicy({
        reasoningReplayPolicy: "tool-calls",
        turnStartMessageCount: messages.length,
        visualHistoryWindow: 4,
      }),
    });

    expect(getAiChatConversationMemoryCoveredMessageCount(prepared[0]!)).toBe(
      null,
    );
    expect(prepared.some((message) => message.role === "assistant")).toBe(true);
  });
});

describe("AI chat context memory planning", () => {
  test("algorithmic compression chooses complete segment boundaries", () => {
    const conversation = [
      ...createToolTurnMessages(),
      { role: "user", content: "Summarize it." },
      { role: "assistant", content: "The page includes an invoice total." },
    ] as AiChatMessageRecord[];

    const result = algorithmicContextCompressionStrategy.build({
      session: {
        conversation,
        timeline: [],
        contextTokens: 100,
        contextTokenOverhead: 0,
      },
      aiChatOptions: {
        contextCompressionEnabled: true,
        contextCompressionThresholdTokens: 1,
        contextCompressionMode: "algorithmic",
        visualHistoryWindow: 4,
      },
      estimateProjectedTokens: (memory) =>
        memory?.coveredMessageCount === 3 ? 40 : 30,
      getTimelineItemCountForConversationMessageCount: (
        _timeline,
        messageCount,
      ) => messageCount,
    });

    expect(result?.coveredMessageCount).toBe(3);
  });

  test("AI memory source uses complete segments and includes tool facts", () => {
    const conversation = [
      ...createToolTurnMessages(),
      { role: "user", content: "Summarize it." },
      { role: "assistant", content: "The page includes an invoice total." },
    ] as AiChatMessageRecord[];

    const plan = getAiChatContextMemoryPlan({
      timeline: [],
      conversation,
      contextMemory: createMemory(1),
      aiChatOptions: {
        contextCompressionEnabled: true,
        contextCompressionMode: "ai",
        contextCompressionThresholdTokens: 1,
      },
      contextTokens: 100,
      getTimelineItemCountForConversationMessageCount: (
        _timeline,
        messageCount,
      ) => messageCount,
    });

    expect(plan?.alreadyCoveredMessageCount).toBe(0);
    expect(plan?.candidateCoveredMessageCount).toBe(5);
    expect(plan?.sourceText).toContain("User: Read page 1.");
    expect(plan?.sourceText).toContain(
      "Tool fact get_pages_text: Found invoice total.; page_count=1",
    );
  });
});
