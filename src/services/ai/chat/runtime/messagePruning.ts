import { pruneMessages } from "ai";

import {
  AI_CHAT_TOOL_HISTORY_WINDOW_MAX,
  AI_CHAT_TOOL_HISTORY_WINDOW_MIN,
  AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MAX,
  AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MIN,
} from "@/constants";
import type { AiChatMessageRecord, AiToolName } from "@/services/ai/chat/types";
import type { AppOptions } from "@/types";

const AI_CHAT_HEAVY_VISUAL_TOOL_NAMES = [
  "get_pages_visual",
  "summarize_pages_visual",
] as const satisfies readonly AiToolName[];

const clampWindowSize = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.trunc(value || 0)));

const toBeforeLastMessagesRule = (
  count: number,
): `before-last-${number}-messages` => `before-last-${count}-messages`;

export const pruneAiChatMessages = (
  messages: AiChatMessageRecord[],
  options: Pick<
    AppOptions["aiChat"],
    | "contextPruningEnabled"
    | "toolHistoryMessageWindow"
    | "visualToolHistoryMessageWindow"
  >,
): AiChatMessageRecord[] => {
  if (!options.contextPruningEnabled) return messages;

  const generalToolWindow = clampWindowSize(
    options.toolHistoryMessageWindow,
    AI_CHAT_TOOL_HISTORY_WINDOW_MIN,
    AI_CHAT_TOOL_HISTORY_WINDOW_MAX,
  );
  const visualToolWindow = clampWindowSize(
    options.visualToolHistoryMessageWindow,
    AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MIN,
    AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MAX,
  );

  return pruneMessages({
    messages,
    reasoning: "all",
    toolCalls: [
      {
        type: toBeforeLastMessagesRule(visualToolWindow),
        tools: [...AI_CHAT_HEAVY_VISUAL_TOOL_NAMES],
      },
      {
        type: toBeforeLastMessagesRule(generalToolWindow),
      },
    ],
    emptyMessages: "remove",
  });
};
