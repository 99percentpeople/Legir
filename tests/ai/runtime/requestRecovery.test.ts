import { describe, expect, test } from "vitest";

import { materializeIncompleteTimelineTail } from "@/services/ai/chat/runtime/requestRecovery";
import { deepseekRuntimeProfile } from "@/services/ai/providers/runtimeProfiles/deepseek";
import type {
  AiChatMessageRecord,
  AiChatTimelineItem,
} from "@/services/ai/chat/types";

const validateDeepSeekReplay = (messages: AiChatMessageRecord[]) =>
  deepseekRuntimeProfile.validateMessages?.(messages, {
    reasoning: { replayPolicy: "tool-calls" },
  } as Parameters<
    NonNullable<typeof deepseekRuntimeProfile.validateMessages>
  >[1]);

describe("AI chat request recovery", () => {
  test("materializes incomplete timeline tools without requiring tool output", () => {
    const timeline = [
      {
        id: "turn_1",
        kind: "message",
        role: "assistant",
        turnId: "turn_1",
        text: "I will inspect the page.",
        createdAt: "2026-04-29T00:00:00.000Z",
      },
      {
        id: "call_1",
        kind: "tool",
        toolCallId: "call_1",
        turnId: "turn_1",
        batchId: "turn_1:step_1",
        toolName: "get_pages_text",
        status: "incomplete",
        argsText: JSON.stringify({ page_numbers: [1] }),
        createdAt: "2026-04-29T00:00:00.000Z",
      },
    ] satisfies AiChatTimelineItem[];

    const messages = materializeIncompleteTimelineTail(timeline);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: "system" });
    expect(messages[0]?.content).toContain("Internal recovery context");
    expect(messages[0]?.content).toContain("I will inspect the page.");
    expect(messages[0]?.content).toContain("Tool input get_pages_text");
    expect(messages[0]?.content).toContain("page_numbers");
    expect(messages[0]?.content).toContain("Tool status get_pages_text");
    expect(messages[0]?.content).toContain("incomplete");
    expect(() => validateDeepSeekReplay(messages)).not.toThrow();
  });

  test("omits large image payloads from recovery context", () => {
    const payload = "a".repeat(5000);
    const timeline = [
      {
        id: "call_1",
        kind: "tool",
        toolCallId: "call_1",
        turnId: "turn_1",
        batchId: "turn_1:step_1",
        toolName: "get_pages_visual",
        status: "done",
        argsText: JSON.stringify({
          page_numbers: [1],
          imageData: payload,
        }),
        resultText: JSON.stringify({
          pageNumber: 1,
          src: `data:image/png;base64,${payload}`,
        }),
        createdAt: "2026-04-29T00:00:00.000Z",
      },
    ] satisfies AiChatTimelineItem[];

    const messages = materializeIncompleteTimelineTail(timeline);

    expect(messages[0]?.content).toContain("get_pages_visual");
    expect(messages[0]?.content).toContain("pageNumber");
    expect(messages[0]?.content).toContain("[omitted large binary data]");
    expect(messages[0]?.content).not.toContain(payload);
  });
});
