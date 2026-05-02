import { describe, expect, test } from "vitest";

import { sanitizeAiChatMessagesForReasoningReplay } from "@/services/ai/chat/runtime/reasoningReplay";
import { deepseekRuntimeProfile } from "@/services/ai/providers/runtimeProfiles/deepseek";
import type { AiChatMessageRecord } from "@/services/ai/chat/types";

const validateDeepSeekReplay = (messages: AiChatMessageRecord[]) =>
  deepseekRuntimeProfile.validateMessages?.(messages, {
    reasoning: { replayPolicy: "tool-calls" },
  } as Parameters<
    NonNullable<typeof deepseekRuntimeProfile.validateMessages>
  >[1]);

describe("AI chat reasoning replay sanitization", () => {
  test("materializes assistant tool calls without reasoning as resumable context", () => {
    const messages = [
      { role: "user", content: "Read page 1." },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "get_pages_text",
            input: { page_numbers: [1] },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "get_pages_text",
            output: { type: "error-text", value: "Cancelled" },
          },
        ],
      },
      { role: "user", content: "Continue." },
    ] as AiChatMessageRecord[];

    expect(() => validateDeepSeekReplay(messages)).toThrow(
      /requires reasoning content/,
    );

    const sanitized = sanitizeAiChatMessagesForReasoningReplay({
      messages,
      replayPolicy: "tool-calls",
    });

    expect(sanitized).toHaveLength(3);
    expect(sanitized[0]).toEqual({ role: "user", content: "Read page 1." });
    expect(sanitized[2]).toEqual({ role: "user", content: "Continue." });
    expect(sanitized[1]).toMatchObject({ role: "system" });
    expect(sanitized[1]?.content).toContain("Internal tool replay context");
    expect(sanitized[1]?.content).toContain("Do not quote");
    expect(sanitized[1]?.content).toContain("Tool input get_pages_text");
    expect(sanitized[1]?.content).toContain("Tool result get_pages_text");
    expect(sanitized[1]?.content).toContain("get_pages_text");
    expect(sanitized[1]?.content).toContain("page_numbers");
    expect(sanitized[1]?.content).toContain("Cancelled");
    expect(() => validateDeepSeekReplay(sanitized)).not.toThrow();
  });

  test("omits large image payloads from incomplete tool context", () => {
    const payload = "a".repeat(5000);
    const messages = [
      { role: "user", content: "Inspect page 1." },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "get_pages_visual",
            input: { page_numbers: [1] },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "get_pages_visual",
            output: {
              type: "json",
              value: {
                pages: [
                  {
                    pageNumber: 1,
                    base64Data: payload,
                    src: `data:image/png;base64,${payload}`,
                  },
                ],
              },
            },
          },
        ],
      },
    ] as AiChatMessageRecord[];

    const sanitized = sanitizeAiChatMessagesForReasoningReplay({
      messages,
      replayPolicy: "tool-calls",
    });

    expect(sanitized[1]?.content).toContain("get_pages_visual");
    expect(sanitized[1]?.content).toContain("pageNumber");
    expect(sanitized[1]?.content).toContain("[omitted large binary data]");
    expect(sanitized[1]?.content).not.toContain(payload);
    expect(() => validateDeepSeekReplay(sanitized)).not.toThrow();
  });

  test("keeps assistant tool calls that include reasoning", () => {
    const messages = [
      { role: "user", content: "Read page 1." },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Need page text." },
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "get_pages_text",
            input: { page_numbers: [1] },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "get_pages_text",
            output: { type: "json", value: { ok: true } },
          },
        ],
      },
    ] as AiChatMessageRecord[];

    const sanitized = sanitizeAiChatMessagesForReasoningReplay({
      messages,
      replayPolicy: "tool-calls",
    });

    expect(sanitized).toBe(messages);
    expect(() => validateDeepSeekReplay(sanitized)).not.toThrow();
  });
});
