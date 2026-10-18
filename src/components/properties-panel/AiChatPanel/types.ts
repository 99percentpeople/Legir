import type {
  AiChatMessageAttachment,
  AiChatTimelineItem,
  AiChatToolPreviewImage,
} from "@/services/ai/chat/types";

export type TranslateFn = (
  key: string,
  params?: Record<string, string | number>,
) => string;

export type ToolTimelineItem = Extract<AiChatTimelineItem, { kind: "tool" }>;
export type MessageTimelineItem = Extract<
  AiChatTimelineItem,
  { kind: "message" }
>;
export type UserMessageTimelineItem = MessageTimelineItem & { role: "user" };

export type TimelineContentEntry =
  | { kind: "item"; item: AiChatTimelineItem }
  | { kind: "tool_batch"; id: string; items: ToolTimelineItem[] };

export type TimelineRenderEntry =
  | TimelineContentEntry
  | {
      kind: "completed_turn";
      id: string;
      activity: TimelineContentEntry[];
      finalMessage: MessageTimelineItem;
      durationMs?: number;
    };

export interface InlineEditState {
  messageId: string;
  text: string;
  attachments: AiChatMessageAttachment[];
  sourceSessionId: string;
  targetMessageId: string;
}

export type ToolTimelinePreviewImage = AiChatToolPreviewImage;
