import type { useAiChatController } from "@/hooks/useAiChatController";
import type {
  AiChatMessageAttachment,
  AiChatTimelineItem,
  AiChatToolPreviewImage,
} from "@/services/ai/chat/types";

export type AiChatController = ReturnType<typeof useAiChatController>;

export interface AiChatPanelProps {
  isFloating: boolean;
  isOpen: boolean;
  onOpen: () => void;
  width: number;
  onResize: (width: number) => void;
  onCollapse: () => void;
  aiChat: AiChatController;
}

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

export type TimelineRenderEntry =
  | { kind: "item"; item: AiChatTimelineItem }
  | { kind: "tool_batch"; id: string; items: ToolTimelineItem[] };

export interface InlineEditState {
  messageId: string;
  text: string;
  attachments: AiChatMessageAttachment[];
  sourceSessionId: string;
  targetMessageId: string;
}

export type ToolTimelinePreviewImage = AiChatToolPreviewImage;
