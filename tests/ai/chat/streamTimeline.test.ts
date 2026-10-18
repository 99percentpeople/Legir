import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_EDITOR_UI_STATE } from "@/constants";
import { createAiConnection } from "@/services/ai/providers/connections";
import { initializeModelsDev } from "@/services/ai/providers/modelsDev";
import { aiChatService } from "@/services/ai/chat/aiChatService";
import {
  applyAssistantUpdateToTimeline,
  applyToolUpdateToTimeline,
} from "@/hooks/useAiChatController/timelineUpdates";
import { buildTimelineRenderEntries } from "@/components/properties-panel/AiChatPanel/timeline";
import type {
  AiChatAssistantUpdate,
  AiChatTimelineItem,
} from "@/services/ai/chat/types";

beforeAll(() => initializeModelsDev());
afterEach(() => vi.unstubAllGlobals());

const appOptions = {
  ...DEFAULT_EDITOR_UI_STATE.options,
  llm: {
    account: {
      ...createAiConnection(),
      catalogId: "deepseek",
      apiKey: "test-key",
      apiUrl: "https://test.invalid/v1",
    },
  },
};

const streamReply = (step: number, finish: "stop" | "length" = "stop") => {
  const base = {
    id: `response-${step}`,
    created: 1,
    model: "deepseek-flash",
    object: "chat.completion.chunk",
  };
  const toolCall = step < 3;
  const deltas = [
    { role: "assistant", reasoning_content: `Thinking ${step}.` },
    { content: toolCall ? `Interim ${step}. ` : "Final answer." },
    ...(toolCall
      ? [
          {
            tool_calls: [
              {
                index: 0,
                id: `call-${step}`,
                type: "function",
                function: {
                  name: "get_pages_text",
                  arguments: JSON.stringify({ page: step }),
                },
              },
            ],
          },
        ]
      : []),
  ];
  const chunks = deltas.map((delta) => ({
    ...base,
    choices: [{ index: 0, delta, finish_reason: null }],
  }));
  const end = {
    ...base,
    choices: [
      { index: 0, delta: {}, finish_reason: toolCall ? "tool_calls" : finish },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  };
  return new Response(
    [...chunks, end]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join("") + "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } },
  );
};

const run = async (maxToolRounds = 5, finish: "stop" | "length" = "stop") => {
  let timeline: AiChatTimelineItem[] = [];
  const updates: AiChatAssistantUpdate[] = [];
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input, init) => {
      requests.push(JSON.parse(String(init.body)));
      return streamReply(requests.length, finish);
    }),
  );
  const result = await aiChatService.runConversation({
    appOptions,
    modelCache: {},
    messages: [{ role: "user", content: "Read two pages." }],
    modelKey: "account:deepseek-flash",
    maxToolRounds,
    toolRegistry: {
      getDefinitions: () => [
        {
          name: "get_pages_text",
          description: "Read page",
          accessType: "read",
          inputSchema: z.object({ page: z.number() }),
        },
      ],
      execute: async (_name, args) => ({
        summary: "Page read",
        payload: { text: "Page text", args },
      }),
    },
    onAssistantUpdate: (update) => {
      updates.push(update);
      timeline = applyAssistantUpdateToTimeline(
        timeline,
        update,
        new Date().toISOString(),
      ).timeline;
    },
    onToolUpdate: (update) => {
      timeline = applyToolUpdateToTimeline(
        timeline,
        update,
        new Date().toISOString(),
      ).timeline;
    },
  });
  return { timeline, requests, updates, result };
};

describe("streamed thinking and final activity", () => {
  test("preserves actual SDK block order through multiple tools and folds only on final completion", async () => {
    const { timeline, requests, updates, result } = await run();
    expect(requests).toHaveLength(3);
    expect(result.awaitingContinue).toBe(false);
    expect(
      timeline.map((item) => (item.kind === "tool" ? item.id : item.text)),
    ).toEqual([
      "Thinking 1.",
      "Interim 1. ",
      "call-1",
      "Thinking 2.",
      "Interim 2. ",
      "call-2",
      "Thinking 3.",
      "Final answer.",
    ]);
    const thinking = timeline.filter(
      (item) => item.kind === "message" && item.role === "thinking",
    );
    expect(new Set(thinking.map((item) => item.id)).size).toBe(3);
    expect(
      updates.filter((update) => update.phase === "segment_end"),
    ).toHaveLength(6);
    expect(timeline.at(-1)).toMatchObject({
      isFinalAnswer: true,
      turnCompleted: true,
      turnDurationMs: expect.any(Number),
    });
    expect(buildTimelineRenderEntries(timeline)).toMatchObject([
      { kind: "completed_turn", finalMessage: { text: "Final answer." } },
    ]);
  });

  test.each(["tool limit", "truncation"])(
    "keeps %s visible rather than treating interim text as a final answer",
    async (mode) => {
      const { timeline, updates, result } = await run(
        mode === "tool limit" ? 1 : 5,
        mode === "truncation" ? "length" : "stop",
      );
      expect(result.awaitingContinue).toBe(mode === "tool limit");
      expect(updates.at(-1)).toMatchObject({
        phase: "end",
        isFinalAnswer: false,
      });
      expect(
        buildTimelineRenderEntries(timeline).some(
          (entry) => entry.kind === "completed_turn",
        ),
      ).toBe(false);
    },
  );
});
