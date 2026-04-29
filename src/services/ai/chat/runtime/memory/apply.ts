import type {
  AiChatContextMemory,
  AiChatMessageRecord,
} from "@/services/ai/chat/types";
import { appendAdditionalCompressedMemoryText } from "@/services/ai/chat/runtime/memory/source";
import {
  buildAiChatContextMemoryMessage,
  parseAiChatConversationMemoryMessage,
} from "@/services/ai/chat/runtime/memory/serialization";
import {
  buildAiChatCompressionSegments,
  getAiChatCompressionSegmentEndAtOrBefore,
} from "@/services/ai/chat/runtime/compression/segments";
import type { AiChatCompressionPolicy } from "@/services/ai/chat/runtime/compression/types";

const getAbsoluteSegmentEndAtOrBefore = (options: {
  messages: AiChatMessageRecord[];
  alreadyCoveredMessageCount: number;
  targetCoveredMessageCount: number;
  maxCoveredMessageCount: number;
}) => {
  const {
    messages,
    alreadyCoveredMessageCount,
    targetCoveredMessageCount,
    maxCoveredMessageCount,
  } = options;
  const localTarget = Math.max(
    0,
    Math.min(
      targetCoveredMessageCount - alreadyCoveredMessageCount,
      maxCoveredMessageCount - alreadyCoveredMessageCount,
      messages.length,
    ),
  );
  return (
    alreadyCoveredMessageCount +
    getAiChatCompressionSegmentEndAtOrBefore(
      buildAiChatCompressionSegments(messages),
      localTarget,
    )
  );
};

const getReasoningReplayCoveredMessageCount = (options: {
  messages: AiChatMessageRecord[];
  alreadyCoveredMessageCount: number;
  targetCoveredMessageCount: number;
  maxCoveredMessageCount: number;
  policy: AiChatCompressionPolicy;
}) => {
  const {
    messages,
    alreadyCoveredMessageCount,
    targetCoveredMessageCount,
    maxCoveredMessageCount,
    policy,
  } = options;
  if (policy.reasoningReplayPolicy !== "tool-calls") {
    return targetCoveredMessageCount;
  }

  const localMaxCoveredMessageCount = Math.max(
    0,
    Math.min(
      maxCoveredMessageCount - alreadyCoveredMessageCount,
      messages.length,
    ),
  );
  let coveredMessageCount = targetCoveredMessageCount;

  for (const segment of buildAiChatCompressionSegments(messages)) {
    const segmentEnd =
      alreadyCoveredMessageCount + segment.endMessageIndexExclusive;
    if (segmentEnd <= coveredMessageCount) continue;
    if (segment.endMessageIndexExclusive > localMaxCoveredMessageCount) break;
    if (!segment.traits.hasAssistantToolCallWithoutReasoning) continue;
    coveredMessageCount = segmentEnd;
  }

  return coveredMessageCount;
};

export const applyAiChatContextMemoryToMessages = (options: {
  messages: AiChatMessageRecord[];
  contextMemory?: AiChatContextMemory;
  policy: AiChatCompressionPolicy;
}) => {
  const sourceMessages = [...options.messages];
  let alreadyCoveredMessageCount = 0;
  let existingMemoryText = "";

  if (sourceMessages[0]) {
    const parsed = parseAiChatConversationMemoryMessage(sourceMessages[0]);
    if (parsed) {
      alreadyCoveredMessageCount = parsed.coveredMessageCount;
      existingMemoryText = parsed.memoryText;
      sourceMessages.shift();
    }
  }

  const contextMemory = options.contextMemory;
  const summaryText = existingMemoryText || contextMemory?.text?.trim();
  if (!summaryText) return sourceMessages;
  if (!contextMemory) return options.messages;

  const maxCoveredMessageCount = Math.min(
    Math.max(0, Math.trunc(options.policy.turnStartMessageCount || 0)),
    sourceMessages.length + alreadyCoveredMessageCount,
  );
  const targetCoveredMessageCount = Math.max(
    alreadyCoveredMessageCount,
    Math.min(
      Math.max(0, options.contextMemory?.coveredMessageCount ?? 0),
      maxCoveredMessageCount,
    ),
  );

  if (targetCoveredMessageCount <= 0) return sourceMessages;

  const normalizedCoveredMessageCount = getAbsoluteSegmentEndAtOrBefore({
    messages: sourceMessages,
    alreadyCoveredMessageCount,
    targetCoveredMessageCount,
    maxCoveredMessageCount,
  });
  const safeCoveredMessageCount = getReasoningReplayCoveredMessageCount({
    messages: sourceMessages,
    alreadyCoveredMessageCount,
    targetCoveredMessageCount: normalizedCoveredMessageCount,
    maxCoveredMessageCount,
    policy: options.policy,
  });
  if (
    safeCoveredMessageCount <= alreadyCoveredMessageCount &&
    !existingMemoryText
  ) {
    return sourceMessages;
  }

  const additionalCoveredMessageCount = Math.max(
    0,
    normalizedCoveredMessageCount - alreadyCoveredMessageCount,
  );
  const safeAdditionalCoveredMessageCount = Math.max(
    0,
    safeCoveredMessageCount - alreadyCoveredMessageCount,
  );
  const extraCompressedMessages = sourceMessages.slice(
    additionalCoveredMessageCount,
    safeAdditionalCoveredMessageCount,
  );
  const memoryText =
    extraCompressedMessages.length > 0
      ? appendAdditionalCompressedMemoryText(
          summaryText,
          extraCompressedMessages,
        )
      : summaryText;
  const remainingMessages =
    safeAdditionalCoveredMessageCount > 0
      ? sourceMessages.slice(safeAdditionalCoveredMessageCount)
      : sourceMessages;

  return [
    buildAiChatContextMemoryMessage({
      ...contextMemory,
      text: memoryText,
      coveredMessageCount: safeCoveredMessageCount,
    }),
    ...remainingMessages,
  ];
};
