import { describe, expect, test } from "vitest";

import { pushUserConversationMessage } from "@/hooks/useAiChatController/conversationActions";
import {
  createAiChatSessionData,
  syncAiChatSessionConversation,
} from "@/hooks/useAiChatController/sessionPersistence";
import type { AiChatMessageRecord } from "@/services/ai/chat/types";

const nowIso = "2026-04-29T00:00:00.000Z";

describe("AI chat conversation actions", () => {
  test("keeps recovery context request-only when pushing a user message", () => {
    const session = createAiChatSessionData("session_1", nowIso);
    const conversationRef = { current: [] as AiChatMessageRecord[] };
    const baseConversation: AiChatMessageRecord[] = [
      { role: "user", content: "Read page 1." },
    ];
    const requestContextMessages: AiChatMessageRecord[] = [
      {
        role: "system",
        content: "Internal recovery context from an unfinished assistant turn.",
      },
    ];

    syncAiChatSessionConversation({
      session,
      conversationRef,
      conversation: baseConversation,
      updatedAt: nowIso,
    });

    const result = pushUserConversationMessage({
      session,
      conversationRef,
      conversationText: "Continue.",
      timelineItemId: "user_2",
      requestContextMessages,
    });

    const userMessage = { role: "user" as const, content: "Continue." };
    expect(result.persistentConversation).toEqual([
      ...baseConversation,
      userMessage,
    ]);
    expect(result.requestConversation).toEqual([
      ...baseConversation,
      ...requestContextMessages,
      userMessage,
    ]);
    expect(session.runtimeTranscript.messages).toEqual(
      result.persistentConversation,
    );
    expect(conversationRef.current).toEqual(result.persistentConversation);
    expect(session.runtimeTranscript.timelineBoundaries.user_2).toBe(2);
  });
});
