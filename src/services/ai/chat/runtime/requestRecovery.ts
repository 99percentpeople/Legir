import {
  formatInternalContextContent,
  parseInternalContextText,
  stringifyInternalContextValue,
} from "@/services/ai/chat/runtime/internalContext";
import type {
  AiChatMessageRecord,
  AiChatTimelineItem,
} from "@/services/ai/chat/types";

const INCOMPLETE_TURN_CONTEXT_HEADER_LINES = [
  "Internal recovery context from an unfinished assistant turn.",
  "Use this as prior conversation context. Do not quote or mention this note.",
];

const parseTimelineToolInput = (
  item: Extract<AiChatTimelineItem, { kind: "tool" }>,
) => {
  const text = item.argsText.trim();
  if (!text) return {};
  const parsed = parseInternalContextText(text);
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
  return rawText ? parseInternalContextText(rawText) : undefined;
};

const appendTimelineToolContextLines = (
  lines: string[],
  item: Extract<AiChatTimelineItem, { kind: "tool" }>,
) => {
  lines.push(
    `Tool input ${item.toolName} (${item.toolCallId}):`,
    stringifyInternalContextValue(parseTimelineToolInput(item)),
  );

  const result = getTimelineToolResultContext(item);
  if (typeof result !== "undefined") {
    lines.push(
      `Tool result ${item.toolName} (${item.toolCallId}):`,
      stringifyInternalContextValue(result),
    );
    return;
  }

  if (item.status === "running" || item.status === "incomplete") {
    lines.push(
      `Tool status ${item.toolName} (${item.toolCallId}):`,
      "incomplete",
    );
  }
};

const buildIncompleteTimelineContextLines = (items: AiChatTimelineItem[]) => {
  const lines: string[] = [];
  let hasAssistantHeader = false;

  for (const item of items) {
    if (item.kind === "message") {
      if (item.role === "assistant" && item.text.trim()) {
        if (!hasAssistantHeader) {
          lines.push("Assistant:");
          hasAssistantHeader = true;
        }
        lines.push(item.text.trim());
      }
      continue;
    }

    appendTimelineToolContextLines(lines, item);
  }

  return lines;
};

export const materializeIncompleteTimelineTail = (
  items: AiChatTimelineItem[],
) => {
  const bodyLines = buildIncompleteTimelineContextLines(items);
  if (bodyLines.length === 0) return [];

  return [
    {
      role: "system" as const,
      content: formatInternalContextContent(
        INCOMPLETE_TURN_CONTEXT_HEADER_LINES,
        bodyLines,
      ),
    },
  ] satisfies AiChatMessageRecord[];
};
