import type {
  AiChatContextMemory,
  AiChatMessageRecord,
} from "@/services/ai/chat/types";

export const AI_CHAT_CONVERSATION_MEMORY_MARKER =
  "[LEGIR_CONVERSATION_MEMORY_V1]";

export type ParsedAiChatConversationMemoryMessage = {
  coveredMessageCount: number;
  memoryText: string;
};

export const retainAiChatContextMemoryForTimeline = (
  memory: AiChatContextMemory | undefined,
  options: {
    timelineItemCount: number;
    conversationMessageCount: number;
  },
) => {
  if (!memory?.text.trim()) return undefined;
  if (memory.coveredTimelineItemCount > options.timelineItemCount) {
    return undefined;
  }
  if (memory.coveredMessageCount > options.conversationMessageCount) {
    return undefined;
  }
  return {
    ...memory,
  };
};

export const buildAiChatContextMemoryMessage = (
  memory: AiChatContextMemory,
): AiChatMessageRecord => ({
  role: "system",
  content: [
    AI_CHAT_CONVERSATION_MEMORY_MARKER,
    `covered_message_count: ${memory.coveredMessageCount}`,
    "",
    "Older conversation memory summary:",
    memory.text.trim(),
  ].join("\n"),
});

export const parseAiChatConversationMemoryMessage = (
  message: AiChatMessageRecord,
): ParsedAiChatConversationMemoryMessage | null => {
  if (message.role !== "system" || typeof message.content !== "string") {
    return null;
  }
  if (!message.content.startsWith(AI_CHAT_CONVERSATION_MEMORY_MARKER)) {
    return null;
  }

  const match = message.content.match(/covered_message_count:\s*(\d+)/);
  const coveredMessageCount = match ? Number.parseInt(match[1] || "0", 10) : 0;
  const memoryHeading = "Older conversation memory summary:";
  const memoryHeadingIndex = message.content.indexOf(memoryHeading);
  const memoryText =
    memoryHeadingIndex >= 0
      ? message.content.slice(memoryHeadingIndex + memoryHeading.length).trim()
      : "";

  return {
    coveredMessageCount: Number.isFinite(coveredMessageCount)
      ? Math.max(0, coveredMessageCount)
      : 0,
    memoryText,
  };
};

export const isAiChatContextMemoryMessage = (message: AiChatMessageRecord) =>
  parseAiChatConversationMemoryMessage(message) !== null;

export const getAiChatConversationMemoryCoveredMessageCount = (
  message: AiChatMessageRecord,
) => parseAiChatConversationMemoryMessage(message)?.coveredMessageCount ?? null;
