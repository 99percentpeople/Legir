import type { AiReasoningReplayPolicy } from "@/services/ai/providers/runtimeProfiles/types";
import type {
  AiChatMessageRecord,
  AiChatTimelineItem,
} from "@/services/ai/chat/types";

const MAX_INCOMPLETE_CONTEXT_VALUE_CHARS = 20_000;
const MAX_INCOMPLETE_CONTEXT_DEPTH = 8;

const OMITTED_CONTEXT_VALUE = "[omitted large binary data]";
const CIRCULAR_CONTEXT_VALUE = "[omitted circular value]";
const DEEP_CONTEXT_VALUE = "[omitted deeply nested value]";

const BINARY_FIELD_NAMES = new Set([
  "arrayBuffer",
  "array_buffer",
  "base64",
  "base64Data",
  "base64_data",
  "blob",
  "buffer",
  "bytes",
  "dataUrl",
  "data_url",
  "imageData",
  "image_data",
]);

const getStructuredContentParts = (message: AiChatMessageRecord) =>
  Array.isArray(message.content) ? message.content : [];

const getObjectRecord = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getToolCallId = (part: unknown) => {
  const record = getObjectRecord(part);
  if (!record) return "";
  return typeof record.toolCallId === "string" ? record.toolCallId : "";
};

const looksLikeBase64Payload = (text: string) =>
  text.length > 4096 && /^[A-Za-z0-9+/=\r\n]+$/.test(text);

const shouldOmitContextString = (key: string | undefined, text: string) => {
  if (BINARY_FIELD_NAMES.has(key ?? "")) return true;
  if (text.startsWith("data:")) return true;
  if ((key === "src" || key === "image") && looksLikeBase64Payload(text)) {
    return true;
  }
  return looksLikeBase64Payload(text);
};

const sanitizeIncompleteContextValue = (
  value: unknown,
  key?: string,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown => {
  if (depth > MAX_INCOMPLETE_CONTEXT_DEPTH) return DEEP_CONTEXT_VALUE;

  if (typeof value === "string") {
    return shouldOmitContextString(key, value) ? OMITTED_CONTEXT_VALUE : value;
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return undefined;
  if (typeof value === "function" || typeof value === "symbol") {
    return String(value);
  }
  if (
    typeof ArrayBuffer !== "undefined" &&
    (value instanceof ArrayBuffer || ArrayBuffer.isView(value))
  ) {
    return OMITTED_CONTEXT_VALUE;
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return CIRCULAR_CONTEXT_VALUE;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizeIncompleteContextValue(item, key, depth + 1, seen),
    );
  }

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record)
      .map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeIncompleteContextValue(entryValue, entryKey, depth + 1, seen),
      ])
      .filter(([, entryValue]) => typeof entryValue !== "undefined"),
  );
};

const truncateContextValue = (text: string) =>
  text.length <= MAX_INCOMPLETE_CONTEXT_VALUE_CHARS
    ? text
    : `${text.slice(0, MAX_INCOMPLETE_CONTEXT_VALUE_CHARS)}\n...(truncated)`;

const stringifyContextValue = (value: unknown) => {
  const sanitized = sanitizeIncompleteContextValue(value);
  if (typeof sanitized === "string") return truncateContextValue(sanitized);
  try {
    const json = JSON.stringify(sanitized, null, 2);
    if (typeof json === "string") return truncateContextValue(json);
  } catch {
    // ignore
  }
  try {
    return truncateContextValue(String(sanitized));
  } catch {
    return "";
  }
};

const getTextPartText = (part: unknown) => {
  const record = getObjectRecord(part);
  if (!record) return "";
  return record.type === "text" && typeof record.text === "string"
    ? record.text.trim()
    : "";
};

export const aiChatMessageHasReasoningText = (message: AiChatMessageRecord) =>
  message.role === "assistant" &&
  getStructuredContentParts(message).some((part) => {
    const record = getObjectRecord(part);
    if (!record) return false;
    return (
      record.type === "reasoning" &&
      typeof record.text === "string" &&
      !!record.text.trim()
    );
  });

export const getUnsafeReasoningReplayToolCallIds = (
  message: AiChatMessageRecord,
) => {
  if (message.role !== "assistant") return [];
  if (aiChatMessageHasReasoningText(message)) return [];

  return getStructuredContentParts(message).flatMap((part) => {
    const record = getObjectRecord(part);
    if (!record) return [];
    if (record.type !== "tool-call") return [];
    const toolCallId = getToolCallId(part);
    return toolCallId ? [toolCallId] : [];
  });
};

type UnsafeReplayToolCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
};

type UnsafeReplayToolResult = {
  toolCallId: string;
  toolName: string;
  output: unknown;
};

type IncompleteTimelineToolContext = {
  toolCallId: string;
  toolName: string;
  input: unknown;
  result?: unknown;
  status?: "running" | "done" | "error" | "incomplete";
};

const INCOMPLETE_TURN_CONTEXT_HEADER_LINES = [
  "Internal recovery context from an unfinished assistant turn.",
  "Use this only to continue the user request. Do not quote or mention this note.",
];

const TOOL_REPLAY_CONTEXT_HEADER_LINES = [
  "Internal tool replay context from an earlier assistant tool use.",
  "Use this as prior conversation context. Do not quote or mention this note.",
];

const formatInternalContextContent = (
  headerLines: string[],
  bodyLines: string[],
) => [...headerLines, ...bodyLines].filter(Boolean).join("\n");

const formatIncompleteContextContent = (bodyLines: string[]) =>
  formatInternalContextContent(INCOMPLETE_TURN_CONTEXT_HEADER_LINES, bodyLines);

const formatToolReplayContextContent = (bodyLines: string[]) =>
  formatInternalContextContent(TOOL_REPLAY_CONTEXT_HEADER_LINES, bodyLines);

const getUnsafeReplayToolCalls = (message: AiChatMessageRecord) => {
  const unsafeIds = new Set(getUnsafeReasoningReplayToolCallIds(message));
  if (unsafeIds.size === 0) return [];

  return getStructuredContentParts(message).flatMap((part) => {
    const record = getObjectRecord(part);
    if (!record || record.type !== "tool-call") return [];
    const toolCallId = getToolCallId(part);
    if (!unsafeIds.has(toolCallId)) return [];
    return [
      {
        toolCallId,
        toolName:
          typeof record.toolName === "string" ? record.toolName : "unknown",
        input: record.input,
      } satisfies UnsafeReplayToolCall,
    ];
  });
};

const getUnsafeReplayToolResult = (
  part: unknown,
  pendingToolCallContextIndexes: Map<string, number>,
) => {
  const record = getObjectRecord(part);
  if (!record || record.type !== "tool-result") return null;
  const toolCallId = getToolCallId(part);
  const contextIndex = pendingToolCallContextIndexes.get(toolCallId);
  if (contextIndex === undefined) return null;

  return {
    contextIndex,
    result: {
      toolCallId,
      toolName:
        typeof record.toolName === "string" ? record.toolName : "unknown",
      output: record.output,
    } satisfies UnsafeReplayToolResult,
  };
};

const formatUnsafeReplayToolCallsContext = (
  toolCalls: UnsafeReplayToolCall[],
  textParts: string[],
) =>
  formatToolReplayContextContent([
    textParts.length > 0 ? ["Assistant:", ...textParts].join("\n") : "",
    ...toolCalls.flatMap((call) => [
      `Tool input ${call.toolName} (${call.toolCallId}):`,
      stringifyContextValue(call.input),
    ]),
  ]);

const formatUnsafeReplayToolResultContext = (result: UnsafeReplayToolResult) =>
  [
    `Tool result ${result.toolName} (${result.toolCallId}):`,
    stringifyContextValue(result.output),
  ].join("\n");

const parseContextText = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const parseTimelineToolInput = (
  item: Extract<AiChatTimelineItem, { kind: "tool" }>,
) => {
  const text = item.argsText.trim();
  if (!text) return {};
  const parsed = parseContextText(text);
  return parsed && typeof parsed === "object" ? parsed : text;
};

const getTimelineToolResultContext = (
  item: Extract<AiChatTimelineItem, { kind: "tool" }>,
) => {
  const rawText =
    typeof item.resultText === "string" && item.resultText.trim()
      ? item.resultText.trim()
      : typeof item.error === "string" && item.error.trim()
        ? item.error.trim()
        : typeof item.resultSummary === "string" && item.resultSummary.trim()
          ? item.resultSummary.trim()
          : "";
  return rawText ? parseContextText(rawText) : undefined;
};

const formatIncompleteTimelineContext = (options: {
  assistantTexts: string[];
  toolContexts: IncompleteTimelineToolContext[];
}) =>
  formatIncompleteContextContent([
    options.assistantTexts.length > 0
      ? ["Assistant:", ...options.assistantTexts].join("\n")
      : "",
    ...options.toolContexts.flatMap((tool) => [
      `Tool input ${tool.toolName} (${tool.toolCallId}):`,
      stringifyContextValue(tool.input),
      typeof tool.result !== "undefined"
        ? [
            `Tool result ${tool.toolName} (${tool.toolCallId}):`,
            stringifyContextValue(tool.result),
          ].join("\n")
        : tool.status === "running" || tool.status === "incomplete"
          ? `Tool status ${tool.toolName} (${tool.toolCallId}):\nincomplete`
          : "",
    ]),
  ]);

const appendAssistantContextText = (
  messages: AiChatMessageRecord[],
  index: number,
  text: string,
) => {
  const message = messages[index];
  if (!message || (message.role !== "assistant" && message.role !== "system")) {
    return;
  }
  messages[index] = {
    ...message,
    content:
      typeof message.content === "string"
        ? `${message.content}\n\n${text}`
        : text,
  };
};

export const materializeUnsafeReasoningReplayToolMessages = (
  messages: AiChatMessageRecord[],
) => {
  const pendingToolCallContextIndexes = new Map<string, number>();
  const next: AiChatMessageRecord[] = [];
  let changed = false;

  for (const message of messages) {
    const unsafeToolCalls = getUnsafeReplayToolCalls(message);
    if (unsafeToolCalls.length > 0) {
      changed = true;
      const contextIndex = next.length;
      for (const call of unsafeToolCalls) {
        pendingToolCallContextIndexes.set(call.toolCallId, contextIndex);
      }
      next.push({
        role: "system",
        content: formatUnsafeReplayToolCallsContext(
          unsafeToolCalls,
          getStructuredContentParts(message)
            .map(getTextPartText)
            .filter(Boolean),
        ),
      });
      continue;
    }

    if (message.role === "tool" && pendingToolCallContextIndexes.size > 0) {
      const parts = getStructuredContentParts(message);
      const filteredParts: unknown[] = [];

      for (const part of parts) {
        const unsafeReplay = getUnsafeReplayToolResult(
          part,
          pendingToolCallContextIndexes,
        );
        if (!unsafeReplay) {
          filteredParts.push(part);
          continue;
        }

        changed = true;
        appendAssistantContextText(
          next,
          unsafeReplay.contextIndex,
          formatUnsafeReplayToolResultContext(unsafeReplay.result),
        );
        pendingToolCallContextIndexes.delete(unsafeReplay.result.toolCallId);
      }

      if (filteredParts.length !== parts.length) {
        if (filteredParts.length > 0) {
          next.push({
            ...message,
            content: filteredParts,
          } as AiChatMessageRecord);
        }
        continue;
      }
    }

    next.push(message);
  }

  return changed ? next : messages;
};

export const materializeIncompleteTimelineTail = (
  items: AiChatTimelineItem[],
) => {
  const assistantTexts: string[] = [];
  const toolContexts: IncompleteTimelineToolContext[] = [];

  for (const item of items) {
    if (item.kind === "message") {
      if (item.role === "assistant" && item.text.trim()) {
        assistantTexts.push(item.text.trim());
      }
      continue;
    }

    toolContexts.push({
      toolCallId: item.toolCallId,
      toolName: item.toolName,
      input: parseTimelineToolInput(item),
      result: getTimelineToolResultContext(item),
      status: item.status,
    });
  }

  if (assistantTexts.length === 0 && toolContexts.length === 0) return [];

  return [
    {
      role: "system" as const,
      content: formatIncompleteTimelineContext({
        assistantTexts,
        toolContexts,
      }),
    },
  ] satisfies AiChatMessageRecord[];
};

export const sanitizeAiChatMessagesForReasoningReplay = (options: {
  messages: AiChatMessageRecord[];
  replayPolicy: AiReasoningReplayPolicy;
}) => {
  if (options.replayPolicy !== "tool-calls") return options.messages;
  return materializeUnsafeReasoningReplayToolMessages(options.messages);
};
