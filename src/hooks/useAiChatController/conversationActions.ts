import type {
  AiChatMessageAttachment,
  AiChatMessageRecord,
  AiChatTimelineItem,
} from "@/services/ai/chat/types";

import {
  buildConversationMessageContent,
  normalizeTimelineForPersist,
  normalizeUserMessageInput,
  restoreConversationFromTimeline,
  type AiChatSessionData,
} from "@/hooks/useAiChatController/sessionPersistence";

export type AiChatFlatModel = {
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  isAvailable: boolean;
};

export type PreparedAiChatUserInput = {
  text: string;
  displayText: string;
  attachments?: AiChatMessageAttachment[];
  conversationText: string;
  editContext?: {
    sourceSessionId: string;
    targetMessageId: string;
  };
};

export const prepareAiChatUserInput = (
  input:
    | string
    | {
        text: string;
        displayText?: string;
        attachments?: AiChatMessageAttachment[];
      },
): PreparedAiChatUserInput | null => {
  const normalized = normalizeUserMessageInput(input);
  const text = normalized.text.trim();
  const displayText = normalized.displayText.trim();
  const attachments = normalized.attachments?.length
    ? normalized.attachments
    : undefined;
  const conversationText = buildConversationMessageContent(text, attachments);
  if (!conversationText) return null;

  return {
    text,
    displayText,
    attachments,
    conversationText,
    editContext: normalized.editContext,
  };
};

export const resolveSelectedAiChatModel = (
  flatModels: AiChatFlatModel[],
  selectedModelKey?: string,
) =>
  flatModels.find(
    (item) => `${item.providerId}:${item.modelId}` === selectedModelKey,
  );

export const createAiChatUserTimelineItem = (options: {
  displayText: string;
  conversationText: string;
  attachments?: AiChatMessageAttachment[];
  branchAnchorId?: string;
  createdAt?: string;
}): AiChatTimelineItem => ({
  id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  kind: "message",
  role: "user",
  text: options.displayText,
  conversationText: options.conversationText,
  attachments: options.attachments,
  branchAnchorId: options.branchAnchorId,
  createdAt: options.createdAt ?? new Date().toISOString(),
});

export const pushUserConversationMessage = (options: {
  session: AiChatSessionData;
  conversationRef: { current: AiChatMessageRecord[] };
  conversationText: string;
}) => {
  const nextConversation: AiChatMessageRecord[] = [
    ...options.conversationRef.current,
    { role: "user", content: options.conversationText },
  ];
  options.conversationRef.current = nextConversation;
  options.session.conversation = nextConversation;
  return nextConversation;
};

export const applyConversationSuccess = (options: {
  session: AiChatSessionData;
  conversationRef: { current: AiChatMessageRecord[] };
  conversation: AiChatMessageRecord[];
}) => {
  options.conversationRef.current = options.conversation;
  options.session.conversation = options.conversation;
  options.session.runStatus = "idle";
};

export const restoreConversationAfterTimelineMutation = (options: {
  session: AiChatSessionData;
  conversationRef: { current: AiChatMessageRecord[] };
  timeline: AiChatTimelineItem[];
  carriedConversation?: AiChatMessageRecord[] | null;
}) => {
  const nextConversation =
    options.carriedConversation ??
    restoreConversationFromTimeline(
      normalizeTimelineForPersist(options.timeline),
    );
  options.session.conversation = nextConversation;
  options.conversationRef.current = nextConversation;
  return nextConversation;
};

export const extractAiChatErrorConversation = (
  error: unknown,
): AiChatMessageRecord[] | null => {
  if (!error || typeof error !== "object") return null;
  const raw = (error as { conversation?: unknown }).conversation;
  if (!Array.isArray(raw)) return null;
  const messages = raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const role = (item as { role?: unknown }).role;
      const content = (item as { content?: unknown }).content;
      if (
        role !== "system" &&
        role !== "user" &&
        role !== "assistant" &&
        role !== "tool"
      ) {
        return null;
      }
      if (typeof content !== "string") return null;
      const toolCallId = (item as { toolCallId?: unknown }).toolCallId;
      const toolName = (item as { toolName?: unknown }).toolName;
      return {
        role,
        content,
        ...(typeof toolCallId === "string" ? { toolCallId } : null),
        ...(typeof toolName === "string" ? { toolName } : null),
      } satisfies AiChatMessageRecord;
    })
    .filter(Boolean) as AiChatMessageRecord[];
  return messages;
};
