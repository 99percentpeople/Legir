import { defaultAiChatCompressionEngine } from "@/services/ai/chat/runtime/compression/engine";
import type {
  AiChatContextMemory,
  AiChatMessageRecord,
} from "@/services/ai/chat/types";
import type { AppOptions } from "@/types";

const ASCII_ALNUM_RE = /[A-Za-z0-9]/;
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
const WHITESPACE_RE = /\s/;

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

const estimateTextTokens = (value: string) => {
  let asciiAlnumCount = 0;
  let cjkCount = 0;
  let otherCount = 0;

  for (const char of value) {
    if (WHITESPACE_RE.test(char)) continue;
    if (ASCII_ALNUM_RE.test(char)) {
      asciiAlnumCount += 1;
      continue;
    }
    if (CJK_RE.test(char)) {
      cjkCount += 1;
      continue;
    }
    otherCount += 1;
  }

  const weighted = asciiAlnumCount / 4 + cjkCount * 1.1 + otherCount / 2 + 1;
  return Math.max(0, Math.ceil(weighted));
};

const estimateStructuredValueTokens = (value: unknown) =>
  estimateTextTokens(safeStringify(value));

const estimateContentPartTokens = (part: unknown): number => {
  if (!part || typeof part !== "object" || Array.isArray(part)) {
    return estimateStructuredValueTokens(part);
  }

  const record = part as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";

  switch (type) {
    case "text":
    case "reasoning":
      return estimateTextTokens(
        typeof record.text === "string" ? record.text : "",
      );
    case "tool-call":
      return estimateTextTokens(
        [
          typeof record.toolName === "string" ? record.toolName : "",
          safeStringify(record.input),
        ]
          .filter(Boolean)
          .join("\n"),
      );
    case "tool-result":
      return estimateTextTokens(
        [
          typeof record.toolName === "string" ? record.toolName : "",
          safeStringify(record.output),
        ]
          .filter(Boolean)
          .join("\n"),
      );
    case "image":
    case "image-data": {
      const data =
        typeof record.data === "string"
          ? record.data
          : typeof record.image === "string"
            ? record.image
            : "";
      const detailText = [
        typeof record.mediaType === "string" ? record.mediaType : "",
        typeof record.alt === "string" ? record.alt : "",
      ]
        .filter(Boolean)
        .join(" ");
      return (
        estimateTextTokens(detailText) +
        Math.max(128, Math.ceil(data.length / 64))
      );
    }
    case "file":
    case "file-data": {
      const data = typeof record.data === "string" ? record.data : "";
      return (
        estimateTextTokens(
          [
            typeof record.mediaType === "string" ? record.mediaType : "",
            typeof record.filename === "string" ? record.filename : "",
          ]
            .filter(Boolean)
            .join(" "),
        ) + Math.max(32, Math.ceil(data.length / 96))
      );
    }
    default:
      return estimateStructuredValueTokens(record);
  }
};

const estimateMessageContentTokens = (
  content: AiChatMessageRecord["content"],
): number => {
  if (typeof content === "string") return estimateTextTokens(content);
  if (!Array.isArray(content)) return estimateStructuredValueTokens(content);
  return content.reduce(
    (total, part) => total + estimateContentPartTokens(part),
    0,
  );
};

type PrepareAiChatMessagesOptions = {
  messages: AiChatMessageRecord[];
  aiChatOptions: Pick<
    AppOptions["aiChat"],
    "contextCompressionEnabled" | "visualHistoryWindow"
  >;
  contextMemory?: AiChatContextMemory;
  turnStartMessageCount: number;
  requiresToolCallReasoningReplay?: boolean;
};

export const prepareAiChatMessagesForModel = (
  options: PrepareAiChatMessagesOptions,
) => defaultAiChatCompressionEngine.prepareProjectedMessages(options);

export const prepareAiChatMessagesForModelRuntime = async (
  options: PrepareAiChatMessagesOptions,
) => await defaultAiChatCompressionEngine.prepareRuntimeMessages(options);

export const estimateAiChatMessageTokens = (messages: AiChatMessageRecord[]) =>
  messages.reduce(
    (total, message) =>
      total + 6 + estimateMessageContentTokens(message.content),
    0,
  );
