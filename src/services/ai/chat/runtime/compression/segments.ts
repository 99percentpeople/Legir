import type { AiChatMessageRecord } from "@/services/ai/chat/types";
import { isAiChatContextMemoryMessage } from "@/services/ai/chat/runtime/memory/serialization";
import { messageContainsAiChatHeavyVisualTool } from "@/services/ai/chat/runtime/memory/source";

export type AiChatCompressionSegmentKind = "memory" | "turn" | "orphan";

export type AiChatCompressionSegmentTraits = {
  hasToolCall: boolean;
  hasToolResult: boolean;
  hasReasoning: boolean;
  hasAssistantToolCallWithoutReasoning: boolean;
  heavyVisualToolMessageCount: number;
};

export type AiChatCompressionSegment = {
  kind: AiChatCompressionSegmentKind;
  startMessageIndex: number;
  endMessageIndexExclusive: number;
  messages: AiChatMessageRecord[];
  traits: AiChatCompressionSegmentTraits;
};

const getStructuredContentParts = (message: AiChatMessageRecord) =>
  Array.isArray(message.content) ? message.content : [];

export const aiChatMessageHasAssistantToolCall = (
  message: AiChatMessageRecord,
) =>
  message.role === "assistant" &&
  getStructuredContentParts(message).some((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return false;
    return (part as Record<string, unknown>).type === "tool-call";
  });

export const aiChatMessageHasAssistantReasoning = (
  message: AiChatMessageRecord,
) =>
  message.role === "assistant" &&
  getStructuredContentParts(message).some((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return false;
    const record = part as Record<string, unknown>;
    return (
      record.type === "reasoning" &&
      typeof record.text === "string" &&
      !!record.text.trim()
    );
  });

const aiChatMessageHasToolResult = (message: AiChatMessageRecord) =>
  message.role === "tool" ||
  getStructuredContentParts(message).some((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return false;
    return (part as Record<string, unknown>).type === "tool-result";
  });

const buildSegmentTraits = (
  messages: AiChatMessageRecord[],
): AiChatCompressionSegmentTraits => {
  const hasToolCall = messages.some(aiChatMessageHasAssistantToolCall);
  const hasReasoning = messages.some(aiChatMessageHasAssistantReasoning);

  return {
    hasToolCall,
    hasToolResult: messages.some(aiChatMessageHasToolResult),
    hasReasoning,
    hasAssistantToolCallWithoutReasoning: messages.some(
      (message) =>
        aiChatMessageHasAssistantToolCall(message) &&
        !aiChatMessageHasAssistantReasoning(message),
    ),
    heavyVisualToolMessageCount: messages.reduce(
      (count, message) =>
        count + (messageContainsAiChatHeavyVisualTool(message) ? 1 : 0),
      0,
    ),
  };
};

const createAiChatCompressionSegment = (
  kind: AiChatCompressionSegmentKind,
  messages: AiChatMessageRecord[],
  startMessageIndex: number,
  endMessageIndexExclusive: number,
): AiChatCompressionSegment => ({
  kind,
  startMessageIndex,
  endMessageIndexExclusive,
  messages,
  traits: buildSegmentTraits(messages),
});

export const buildAiChatCompressionSegments = (
  messages: AiChatMessageRecord[],
): AiChatCompressionSegment[] => {
  const segments: AiChatCompressionSegment[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index]!;

    if (isAiChatContextMemoryMessage(message)) {
      segments.push(
        createAiChatCompressionSegment("memory", [message], index, index + 1),
      );
      index += 1;
      continue;
    }

    if (message.role === "user") {
      const startIndex = index;
      index += 1;
      while (
        index < messages.length &&
        messages[index]?.role !== "user" &&
        !isAiChatContextMemoryMessage(messages[index]!)
      ) {
        index += 1;
      }
      segments.push(
        createAiChatCompressionSegment(
          "turn",
          messages.slice(startIndex, index),
          startIndex,
          index,
        ),
      );
      continue;
    }

    segments.push(
      createAiChatCompressionSegment("orphan", [message], index, index + 1),
    );
    index += 1;
  }

  return segments;
};

export const getAiChatCompressionSegmentEndAtOrBefore = (
  segments: readonly AiChatCompressionSegment[],
  messageCount: number,
) => {
  const target = Math.max(0, Math.trunc(messageCount || 0));
  let coveredMessageCount = 0;

  for (const segment of segments) {
    if (segment.endMessageIndexExclusive > target) break;
    coveredMessageCount = segment.endMessageIndexExclusive;
  }

  return coveredMessageCount;
};

export const getLastAiChatCompressionSegmentEnd = (
  segments: readonly AiChatCompressionSegment[],
) => segments.at(-1)?.endMessageIndexExclusive ?? 0;
