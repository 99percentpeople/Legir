import {
  AI_CHAT_CONVERSATION_SUMMARY_MAX_CHARS,
  AI_CHAT_CONVERSATION_SUMMARY_MAX_SOURCE_CHARS,
} from "@/constants";
import type {
  AiChatContextMemory,
  AiChatMessageRecord,
  AiChatTimelineItem,
  AiToolName,
} from "@/services/ai/chat/types";
import type { AppOptions } from "@/types";

export type AiChatContextMemoryPlan = {
  sourceText: string;
  candidateCoveredTimelineItemCount: number;
  candidateCoveredMessageCount: number;
  alreadyCoveredTimelineItemCount: number;
  alreadyCoveredMessageCount: number;
};

const AI_CHAT_CONVERSATION_MEMORY_MARKER = "[LEGIR_CONVERSATION_MEMORY_V1]";

const AI_CHAT_CONVERSATION_SUMMARY_TOOL_RESULT_MAX_CHARS = 2_400;
const AI_CHAT_ALGORITHMIC_MEMORY_LINE_MAX_CHARS = 320;
const CONTEXT_MEMORY_PREFERRED_TOOL_TEXT_KEYS = [
  "summary",
  "result_summary",
  "message",
  "reason",
  "error",
  "status",
  "text",
] as const;
const CONTEXT_MEMORY_PREFERRED_TOOL_COUNT_KEYS = [
  "created_count",
  "updated_count",
  "deleted_count",
  "applied_count",
  "filled_count",
  "matched_count",
  "returned_count",
  "field_count",
  "annotation_count",
  "page_count",
  "requested_page_count",
  "returned_page_count",
  "skipped_count",
  "rejected_count",
] as const;
const AI_CHAT_HEAVY_VISUAL_TOOL_NAMES = new Set<AiToolName>([
  "get_pages_visual",
  "summarize_pages_visual",
]);

const trimText = (value: string) => value.trim();

const truncateText = (value: string, maxChars: number) => {
  const text = trimText(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
};

const safeStringify = (value: unknown) => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "";
    }
  }
};

const truncateSummarySource = (lines: string[]) => {
  const result: string[] = [];
  let totalChars = 0;

  for (const line of lines) {
    if (!line) continue;
    const nextLength = totalChars + line.length + 1;
    if (nextLength > AI_CHAT_CONVERSATION_SUMMARY_MAX_SOURCE_CHARS) {
      result.push(
        "System note: additional older turns were omitted from this summary update chunk.",
      );
      break;
    }
    result.push(line);
    totalChars = nextLength;
  }

  return result.join("\n");
};

const formatCompactScalar = (value: unknown) => {
  if (typeof value === "string") return trimText(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
};

/**
 * Compresses raw tool output into durable facts.
 *
 * The memory model should focus on user intent and resulting document state, so
 * we aggressively strip away tool mechanics and keep only compact facts such as
 * counts, short status text, and the most useful message field.
 */
const summarizeToolOutputForContextMemory = (
  toolName: string,
  output: unknown,
) => {
  if (output == null) return "";
  if (typeof output === "string") {
    return truncateText(
      output,
      AI_CHAT_CONVERSATION_SUMMARY_TOOL_RESULT_MAX_CHARS,
    );
  }
  if (Array.isArray(output)) {
    return truncateText(
      safeStringify(output),
      Math.min(600, AI_CHAT_CONVERSATION_SUMMARY_TOOL_RESULT_MAX_CHARS),
    );
  }
  if (typeof output !== "object") {
    return formatCompactScalar(output);
  }

  const record = output as Record<string, unknown>;
  if (record.type === "content" && Array.isArray(record.value)) {
    const textParts = record.value
      .filter(
        (part) =>
          part &&
          typeof part === "object" &&
          !Array.isArray(part) &&
          (part as Record<string, unknown>).type === "text" &&
          typeof (part as Record<string, unknown>).text === "string",
      )
      .map((part) => trimText((part as Record<string, unknown>).text as string))
      .filter(Boolean);
    if (textParts.length > 0) {
      return truncateText(
        textParts.join(" "),
        AI_CHAT_CONVERSATION_SUMMARY_TOOL_RESULT_MAX_CHARS,
      );
    }
    if (AI_CHAT_HEAVY_VISUAL_TOOL_NAMES.has(toolName as AiToolName)) {
      return "";
    }
  }

  const parts: string[] = [];

  for (const key of CONTEXT_MEMORY_PREFERRED_TOOL_TEXT_KEYS) {
    const text = formatCompactScalar(record[key]);
    if (!text) continue;
    parts.push(truncateText(text, 300));
    break;
  }

  for (const key of CONTEXT_MEMORY_PREFERRED_TOOL_COUNT_KEYS) {
    const value = record[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    parts.push(`${key}=${Math.trunc(value)}`);
  }

  if (
    typeof record.page_number === "number" &&
    Number.isFinite(record.page_number)
  ) {
    parts.push(`page_number=${Math.trunc(record.page_number)}`);
  }
  if (Array.isArray(record.page_numbers) && record.page_numbers.length > 0) {
    const pageNumbers = record.page_numbers
      .map((value) =>
        typeof value === "number" && Number.isFinite(value)
          ? Math.trunc(value)
          : null,
      )
      .filter((value): value is number => value !== null)
      .slice(0, 8);
    if (pageNumbers.length > 0) {
      parts.push(`page_numbers=${pageNumbers.join(",")}`);
    }
  }

  if (parts.length > 0) {
    return truncateText(
      parts.join("; "),
      AI_CHAT_CONVERSATION_SUMMARY_TOOL_RESULT_MAX_CHARS,
    );
  }

  return truncateText(
    safeStringify(output),
    Math.min(600, AI_CHAT_CONVERSATION_SUMMARY_TOOL_RESULT_MAX_CHARS),
  );
};

const getContextMemorySourceLines = (
  messages: AiChatMessageRecord[],
): string[] => {
  const lines: string[] = [];

  for (const message of messages) {
    if (message.role === "system") continue;

    if (typeof message.content === "string") {
      const text = trimText(message.content);
      if (!text) continue;
      if (message.role === "tool") {
        const toolFact = summarizeToolOutputForContextMemory("tool", text);
        if (toolFact) {
          lines.push(`Tool fact: ${toolFact}`);
        }
      } else {
        const label = message.role === "user" ? "User" : "Assistant";
        lines.push(`${label}: ${text}`);
      }
      continue;
    }

    if (!Array.isArray(message.content)) continue;

    for (const part of message.content) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      const record = part as Record<string, unknown>;
      const type = typeof record.type === "string" ? record.type : "";

      if (type === "reasoning") continue;
      if (type === "text") {
        const text =
          typeof record.text === "string" ? trimText(record.text) : "";
        if (!text) continue;
        const label = message.role === "user" ? "User" : "Assistant";
        lines.push(`${label}: ${text}`);
        continue;
      }
      if (type === "tool-call") {
        continue;
      }
      if (type === "tool-result") {
        const toolName =
          typeof record.toolName === "string" ? record.toolName : "unknown";
        const toolFact = summarizeToolOutputForContextMemory(
          toolName,
          record.output,
        );
        if (toolFact) {
          lines.push(`Tool fact ${toolName}: ${toolFact}`);
        }
      }
    }
  }

  return lines;
};

const getAssistantToolCallIds = (message: AiChatMessageRecord) => {
  if (message.role !== "assistant" || !Array.isArray(message.content)) {
    return [] as string[];
  }

  return message.content.flatMap((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return [];
    const record = part as Record<string, unknown>;
    if (record.type !== "tool-call" || typeof record.toolCallId !== "string") {
      return [];
    }
    return [record.toolCallId];
  });
};

const hasAssistantReasoningPart = (message: AiChatMessageRecord) =>
  message.role === "assistant" &&
  Array.isArray(message.content) &&
  message.content.some((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return false;
    const record = part as Record<string, unknown>;
    return (
      record.type === "reasoning" &&
      typeof record.text === "string" &&
      !!record.text.trim()
    );
  });

const hasAssistantToolCallWithoutReasoning = (message: AiChatMessageRecord) =>
  getAssistantToolCallIds(message).length > 0 &&
  !hasAssistantReasoningPart(message);

const getToolResultIds = (message: AiChatMessageRecord) => {
  if (message.role !== "tool" || !Array.isArray(message.content)) {
    return [] as string[];
  }

  return message.content.flatMap((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return [];
    const record = part as Record<string, unknown>;
    if (
      record.type !== "tool-result" ||
      typeof record.toolCallId !== "string"
    ) {
      return [];
    }
    return [record.toolCallId];
  });
};

const extendCoveredCountThroughMatchingToolResults = (options: {
  messages: AiChatMessageRecord[];
  alreadyCoveredMessageCount: number;
  assistantMessageIndex: number;
  maxCoveredMessageCount: number;
}) => {
  const {
    messages,
    alreadyCoveredMessageCount,
    assistantMessageIndex,
    maxCoveredMessageCount,
  } = options;
  const pendingToolCallIds = new Set(
    getAssistantToolCallIds(messages[assistantMessageIndex]!),
  );
  let coveredMessageCount =
    alreadyCoveredMessageCount + assistantMessageIndex + 1;

  for (
    let index = assistantMessageIndex + 1;
    index < messages.length &&
    alreadyCoveredMessageCount + index < maxCoveredMessageCount;
    index += 1
  ) {
    const message = messages[index];
    if (message?.role !== "tool") break;

    const resultIds = getToolResultIds(message);
    if (!resultIds.some((id) => pendingToolCallIds.has(id))) break;

    coveredMessageCount = alreadyCoveredMessageCount + index + 1;
    for (const id of resultIds) {
      pendingToolCallIds.delete(id);
    }
  }

  return coveredMessageCount;
};

const getReasoningReplaySafeCoveredMessageCount = (options: {
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
  let coveredMessageCount = targetCoveredMessageCount;

  while (coveredMessageCount < maxCoveredMessageCount) {
    const scanStartIndex = Math.max(
      0,
      coveredMessageCount - alreadyCoveredMessageCount,
    );
    let nextCoveredMessageCount = coveredMessageCount;

    for (
      let index = scanStartIndex;
      index < messages.length &&
      alreadyCoveredMessageCount + index < maxCoveredMessageCount;
      index += 1
    ) {
      if (!hasAssistantToolCallWithoutReasoning(messages[index]!)) continue;

      nextCoveredMessageCount = extendCoveredCountThroughMatchingToolResults({
        messages,
        alreadyCoveredMessageCount,
        assistantMessageIndex: index,
        maxCoveredMessageCount,
      });
      break;
    }

    if (nextCoveredMessageCount <= coveredMessageCount) break;
    coveredMessageCount = nextCoveredMessageCount;
  }

  return coveredMessageCount;
};

const appendAdditionalCompressedMemoryText = (
  memoryText: string,
  messages: AiChatMessageRecord[],
) => {
  const lines = getContextMemorySourceLines(messages);
  if (lines.length === 0) return memoryText;

  return [memoryText, "", "Additional compressed context:", ...lines].join(
    "\n",
  );
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

const buildAiChatContextMemoryMessage = (
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

const parseAiChatConversationMemoryMessage = (message: AiChatMessageRecord) => {
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

export const getAiChatConversationMemoryCoveredMessageCount = (
  message: AiChatMessageRecord,
) => parseAiChatConversationMemoryMessage(message)?.coveredMessageCount ?? null;

const getMessageSpeakerLines = (message: AiChatMessageRecord) => {
  if (message.role === "system" || message.role === "tool")
    return [] as string[];

  const label = message.role === "user" ? "User" : "Assistant";
  const pushLine = (lines: string[], value: string) => {
    const text = trimText(value);
    if (!text) return;
    lines.push(
      `${label}: ${truncateText(text, AI_CHAT_ALGORITHMIC_MEMORY_LINE_MAX_CHARS)}`,
    );
  };

  if (typeof message.content === "string") {
    const lines: string[] = [];
    pushLine(lines, message.content);
    return lines;
  }

  if (!Array.isArray(message.content)) return [] as string[];

  const lines: string[] = [];
  for (const part of message.content) {
    if (!part || typeof part !== "object" || Array.isArray(part)) continue;
    const record = part as Record<string, unknown>;
    if (record.type !== "text") continue;
    pushLine(lines, typeof record.text === "string" ? record.text : "");
  }
  return lines;
};

const renderMemorySection = (
  heading: string,
  lines: string[],
  remainingChars: number,
) => {
  if (remainingChars <= 0 || lines.length === 0) {
    return { text: "", remainingChars };
  }

  const output: string[] = [];
  const push = (value: string) => {
    if (!value) return false;
    const candidate = output.length === 0 ? value : `\n${value}`;
    if (remainingChars - candidate.length < 0) return false;
    output.push(value);
    remainingChars -= candidate.length;
    return true;
  };

  if (!push(heading)) {
    return { text: "", remainingChars };
  }

  for (const line of lines) {
    if (!push(line)) break;
  }

  return {
    text: output.join("\n"),
    remainingChars,
  };
};

const uniqueLines = (lines: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    if (!line || seen.has(line)) continue;
    seen.add(line);
    result.push(line);
  }
  return result;
};

export const buildAiChatAlgorithmicMemoryText = (
  messages: AiChatMessageRecord[],
) => {
  const allLines = uniqueLines(messages.flatMap(getMessageSpeakerLines));
  if (allLines.length === 0) return "";

  const openingLines = allLines.slice(0, 3);
  const recentLines = allLines.slice(-4);

  let remainingChars = AI_CHAT_CONVERSATION_SUMMARY_MAX_CHARS;
  const blocks: string[] = [];

  const intro =
    "I compressed older context and kept the beginning plus the latest conclusion. Intermediate tool activity was omitted.";
  if (intro.length <= remainingChars) {
    blocks.push(intro);
    remainingChars -= intro.length;
  }

  const openingSection = renderMemorySection(
    "Beginning:",
    openingLines,
    remainingChars - (blocks.length > 0 ? 2 : 0),
  );
  if (openingSection.text) {
    if (blocks.length > 0) remainingChars -= 2;
    blocks.push(openingSection.text);
    remainingChars = openingSection.remainingChars;
  }

  const recentSection = renderMemorySection(
    "Latest conclusion:",
    uniqueLines(recentLines),
    remainingChars - (blocks.length > 0 ? 2 : 0),
  );
  if (recentSection.text) {
    if (blocks.length > 0) remainingChars -= 2;
    blocks.push(recentSection.text);
  }

  return blocks.join("\n\n").trim();
};

const messageContainsHeavyVisualTool = (message: AiChatMessageRecord) => {
  if (typeof message.content === "string" || !Array.isArray(message.content)) {
    return false;
  }

  return message.content.some((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return false;
    const record = part as Record<string, unknown>;
    const toolName =
      typeof record.toolName === "string"
        ? (record.toolName as AiToolName)
        : null;
    return !!toolName && AI_CHAT_HEAVY_VISUAL_TOOL_NAMES.has(toolName);
  });
};

export const countAiChatHeavyVisualToolMessages = (
  messages: AiChatMessageRecord[],
) =>
  messages.reduce(
    (count, message) =>
      count + (messageContainsHeavyVisualTool(message) ? 1 : 0),
    0,
  );

export const applyAiChatContextMemoryToMessages = (options: {
  messages: AiChatMessageRecord[];
  contextMemory?: AiChatContextMemory;
  turnStartMessageCount: number;
  requiresToolCallReasoningReplay?: boolean;
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

  const targetCoveredMessageCount = Math.max(
    alreadyCoveredMessageCount,
    Math.min(
      Math.max(0, options.contextMemory?.coveredMessageCount ?? 0),
      Math.max(0, options.turnStartMessageCount),
      sourceMessages.length + alreadyCoveredMessageCount,
    ),
  );

  if (targetCoveredMessageCount <= 0) return sourceMessages;

  const additionalCoveredMessageCount = Math.max(
    0,
    targetCoveredMessageCount - alreadyCoveredMessageCount,
  );
  const maxCoveredMessageCount = Math.min(
    Math.max(0, options.turnStartMessageCount),
    sourceMessages.length + alreadyCoveredMessageCount,
  );
  const safeCoveredMessageCount = options.requiresToolCallReasoningReplay
    ? getReasoningReplaySafeCoveredMessageCount({
        messages: sourceMessages,
        alreadyCoveredMessageCount,
        targetCoveredMessageCount,
        maxCoveredMessageCount,
      })
    : targetCoveredMessageCount;
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
}): AiChatContextMemoryPlan | null => {
  if (!options.aiChatOptions.contextCompressionEnabled) return null;
  if (options.aiChatOptions.contextCompressionMode !== "ai") return null;
  const candidateCoveredTimelineItemCount = options.timeline.length;
  const candidateCoveredMessageCount = options.conversation.length;
  const alreadyCoveredTimelineItemCount = Math.min(
    options.contextMemory?.coveredTimelineItemCount ?? 0,
    options.timeline.length,
  );
  const alreadyCoveredMessageCount = Math.min(
    options.contextMemory?.coveredMessageCount ?? 0,
    options.conversation.length,
  );

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
  const sourceText = truncateSummarySource(
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
