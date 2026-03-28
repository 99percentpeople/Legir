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

const AI_CHAT_CONVERSATION_MEMORY_MARKER = "[FORMFORGE_CONVERSATION_MEMORY_V1]";

const AI_CHAT_CONVERSATION_SUMMARY_TOOL_RESULT_MAX_CHARS = 2_400;
const AI_CHAT_ALGORITHMIC_MEMORY_LINE_MAX_CHARS = 320;
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
        lines.push(
          `Tool result: ${truncateText(text, AI_CHAT_CONVERSATION_SUMMARY_TOOL_RESULT_MAX_CHARS)}`,
        );
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
        const toolName =
          typeof record.toolName === "string" ? record.toolName : "unknown";
        lines.push(`Tool call ${toolName}: ${safeStringify(record.input)}`);
        continue;
      }
      if (type === "tool-result") {
        const toolName =
          typeof record.toolName === "string" ? record.toolName : "unknown";
        lines.push(
          `Tool result ${toolName}: ${truncateText(
            safeStringify(record.output),
            AI_CHAT_CONVERSATION_SUMMARY_TOOL_RESULT_MAX_CHARS,
          )}`,
        );
      }
    }
  }

  return lines;
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

  return {
    coveredMessageCount: Number.isFinite(coveredMessageCount)
      ? Math.max(0, coveredMessageCount)
      : 0,
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
}) => {
  const sourceMessages = [...options.messages];
  let alreadyCoveredMessageCount = 0;

  if (sourceMessages[0]) {
    const parsed = parseAiChatConversationMemoryMessage(sourceMessages[0]);
    if (parsed) {
      alreadyCoveredMessageCount = parsed.coveredMessageCount;
      sourceMessages.shift();
    }
  }

  const summaryText = options.contextMemory?.text?.trim();
  if (!summaryText) return sourceMessages;

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
  const remainingMessages =
    additionalCoveredMessageCount > 0
      ? sourceMessages.slice(additionalCoveredMessageCount)
      : sourceMessages;

  return [
    buildAiChatContextMemoryMessage({
      ...options.contextMemory!,
      coveredMessageCount: targetCoveredMessageCount,
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
