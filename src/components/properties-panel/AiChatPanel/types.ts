import type { ModelSelectGroup } from "@/components/ModelSelect";
import type {
  AiChatMessageAttachment,
  AiChatSessionSummary,
  AiChatTimelineItem,
  AiChatTokenUsageSummary,
  AiDocumentLinkTarget,
  AiChatUserMessageInput,
  AiChatToolPreviewImage,
} from "@/services/ai/chat/types";

export interface AiChatPanelProps {
  isFloating: boolean;
  isOpen: boolean;
  onOpen: () => void;
  width: number;
  onResize: (width: number) => void;
  onCollapse: () => void;

  sessions: AiChatSessionSummary[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  canDeleteConversation: (id: string) => boolean;

  timeline: AiChatTimelineItem[];
  runStatus: "idle" | "running" | "cancelling" | "error";
  lastError: string | null;
  awaitingContinue: boolean;
  isContextCompressionRunning: boolean;
  tokenUsage: AiChatTokenUsageSummary;
  contextTokens: number;

  selectedModelKey?: string;
  onSelectModel: (value: string) => void;
  modelGroups: ModelSelectGroup[];

  onSend: (input: AiChatUserMessageInput) => void;
  onContinueConversation: () => Promise<void> | void;
  onRegenerateMessage: (messageId: string) => Promise<void> | void;
  onRetryLastError: () => Promise<void> | void;
  onEditUserMessage: (messageId: string) => {
    text: string;
    attachments?: AiChatMessageAttachment[];
    sourceSessionId: string;
    targetMessageId: string;
  } | null;
  onStop: () => void;
  onOpenDocumentLink: (target: AiDocumentLinkTarget) => void;
  disabledReason: "no_document" | "no_model" | null;
  formToolsEnabled: boolean;
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
