import { modelMessageSchema } from "ai";

import type {
  AiChatMessageAttachment,
  AiChatMessageRecord,
  AiChatTimelineItem,
} from "@/services/ai/chat/types";
import type { LLMModelCapabilities } from "@/types";

import {
  buildConversationMessageContent,
  normalizeTimelineForPersist,
  normalizeUserMessageInput,
  recoverAiChatRuntimeTranscript,
  setAiChatRuntimeTimelineBoundary,
  syncAiChatSessionConversation,
  type AiChatSessionData,
} from "@/hooks/useAiChatController/sessionPersistence";

export type AiChatFlatModel = {
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  capabilities: LLMModelCapabilities;
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
  timelineItemId: string;
  modelKey?: string;
  requestContextMessages?: AiChatMessageRecord[];
}) => {
  const baseConversation = [...options.conversationRef.current];
  const userMessage = {
    role: "user" as const,
    content: options.conversationText,
  };
  const nextConversation: AiChatMessageRecord[] = [
    ...baseConversation,
    userMessage,
  ];
  syncAiChatSessionConversation({
    session: options.session,
    conversationRef: options.conversationRef,
    conversation: nextConversation,
    modelKey: options.modelKey,
  });
  setAiChatRuntimeTimelineBoundary({
    session: options.session,
    timelineItemId: options.timelineItemId,
    messageCount: nextConversation.length,
  });
  return {
    persistentConversation: nextConversation,
    requestConversation: options.requestContextMessages?.length
      ? [...baseConversation, ...options.requestContextMessages, userMessage]
      : nextConversation,
  };
};

export const applyConversationSuccess = (options: {
  session: AiChatSessionData;
  conversationRef: { current: AiChatMessageRecord[] };
  conversation: AiChatMessageRecord[];
  modelKey?: string;
}) => {
  syncAiChatSessionConversation({
    session: options.session,
    conversationRef: options.conversationRef,
    conversation: options.conversation,
    modelKey: options.modelKey,
  });
  options.session.runStatus = "idle";
  options.session.lastError = null;
  options.session.awaitingContinue = false;
};

export const restoreConversationAfterTimelineMutation = (options: {
  session: AiChatSessionData;
  conversationRef: { current: AiChatMessageRecord[] };
  timeline: AiChatTimelineItem[];
  carriedConversation?: AiChatMessageRecord[] | null;
}) => {
  const nextConversation = options.carriedConversation
    ? options.carriedConversation
    : recoverAiChatRuntimeTranscript({
        sourceSession: options.session,
        timeline: normalizeTimelineForPersist(options.timeline),
      }).messages;
  syncAiChatSessionConversation({
    session: options.session,
    conversationRef: options.conversationRef,
    conversation: nextConversation,
  });
  return nextConversation;
};

export const extractAiChatErrorConversation = (
  error: unknown,
): AiChatMessageRecord[] | null => {
  if (!error || typeof error !== "object") return null;
  const raw = (error as { conversation?: unknown }).conversation;
  if (!Array.isArray(raw)) return null;
  const messages = raw.flatMap((item) => {
    const parsed = modelMessageSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  return messages;
};
