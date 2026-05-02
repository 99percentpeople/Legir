import {
  formatInternalContextContent,
  stringifyInternalContextValue,
} from "@/services/ai/chat/runtime/internalContext";
import type { AiReasoningReplayPolicy } from "@/services/ai/providers/runtimeProfiles/types";
import type { AiChatMessageRecord } from "@/services/ai/chat/types";

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

const TOOL_REPLAY_CONTEXT_HEADER_LINES = [
  "Internal tool replay context from an earlier assistant tool use.",
  "Use this as prior conversation context. Do not quote or mention this note.",
];

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
      stringifyInternalContextValue(call.input),
    ]),
  ]);

const formatUnsafeReplayToolResultContext = (result: UnsafeReplayToolResult) =>
  [
    `Tool result ${result.toolName} (${result.toolCallId}):`,
    stringifyInternalContextValue(result.output),
  ].join("\n");

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

export const sanitizeAiChatMessagesForReasoningReplay = (options: {
  messages: AiChatMessageRecord[];
  replayPolicy: AiReasoningReplayPolicy;
}) => {
  if (options.replayPolicy !== "tool-calls") return options.messages;
  return materializeUnsafeReasoningReplayToolMessages(options.messages);
};
