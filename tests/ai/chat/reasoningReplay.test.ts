import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_EDITOR_UI_STATE } from "@/constants";
import { createAiConnection } from "@/services/ai/providers/connections";
import { initializeModelsDev } from "@/services/ai/providers/modelsDev";
import { aiChatService } from "@/services/ai/chat/aiChatService";
import type {
  AiChatAssistantUpdate,
  AiChatMessageRecord,
} from "@/services/ai/chat/types";
import type { AiReasoningPreference } from "@/services/ai/providers/runtimeAdapters/types";

beforeAll(() => initializeModelsDev());
afterEach(() => vi.unstubAllGlobals());

type Reply = { reasoning?: string | null; pages?: number[] };
type RequestMessage = {
  role: string;
  content: string | null;
  reasoning_content?: string;
  tool_calls?: { id: string }[];
  tool_call_id?: string;
};
const pageInput = z.object({ page: z.number() });

const streamReply = ({ reasoning, pages = [] }: Reply) => {
  const deltas = [
    { role: "assistant", reasoning_content: reasoning },
    { content: pages.length ? "Reading pages." : "Final answer." },
    ...(pages.length
      ? [
          {
            tool_calls: pages.map((page, index) => ({
              index,
              id: `page-${page}`,
              type: "function",
              function: {
                name: "get_pages_text",
                arguments: JSON.stringify({ page }),
              },
            })),
          },
        ]
      : []),
  ];
  const chunks = [
    ...deltas.map((delta) => ({ delta, finish_reason: null })),
    { delta: {}, finish_reason: pages.length ? "tool_calls" : "stop" },
  ];
  return new Response(
    chunks
      .map(
        (choice) =>
          `data: ${JSON.stringify({
            id: "reply",
            object: "chat.completion.chunk",
            created: 1,
            model: "deepseek-flash",
            choices: [{ index: 0, ...choice }],
          })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } },
  );
};

const run = async (
  replies: Reply[],
  options: {
    messages?: AiChatMessageRecord[];
    preference?: AiReasoningPreference;
  } = {},
) => {
  const requests: { messages: RequestMessage[] }[] = [];
  const updates: AiChatAssistantUpdate[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input, init) => {
      requests.push(JSON.parse(String(init.body)));
      const reply = replies[requests.length - 1];
      if (!reply) throw new Error("Unexpected model request");
      return streamReply(reply);
    }),
  );
  const execute = vi.fn(async (_name: string, rawArgs: unknown) => {
    const args = pageInput.parse(rawArgs);
    return {
      summary: `Read page ${args.page}`,
      payload: { text: `Page ${args.page} contents` },
    };
  });
  const defaults = DEFAULT_EDITOR_UI_STATE.options;
  const result = await aiChatService.runConversation({
    appOptions: {
      ...defaults,
      llm: {
        account: {
          ...createAiConnection(),
          catalogId: "deepseek",
          apiKey: "test-key",
          apiUrl: "https://test.invalid/v1",
        },
      },
      aiChat: {
        ...defaults.aiChat,
        reasoning: options.preference ?? defaults.aiChat.reasoning,
      },
    },
    modelCache: {},
    messages: options.messages ?? [{ role: "user", content: "Read pages." }],
    modelKey: "account:deepseek-flash",
    maxToolRounds: 5,
    toolRegistry: {
      getDefinitions: () => [
        {
          name: "get_pages_text",
          description: "Read page",
          accessType: "read",
          inputSchema: pageInput,
        },
      ],
      execute,
    },
    onAssistantUpdate: (update) => updates.push(update),
  });
  return { result, requests, updates, execute };
};

describe("reasoning replay between streamed tool steps", () => {
  test.each([undefined, null, "", " \n "])(
    "continues when a tool step returns reasoning_content=%j, preserving prior reasoning and completed results",
    async (reasoning) => {
      const { result, requests, execute } = await run([
        { reasoning: "Original thought.", pages: [1] },
        { reasoning, pages: [2, 3] },
        { reasoning: "Conclude from the page results." },
      ]);

      expect(requests).toHaveLength(3);
      expect(execute.mock.calls.map(([, args]) => args)).toEqual([
        { page: 1 },
        { page: 2 },
        { page: 3 },
      ]);
      const messages = requests[2].messages;
      expect(messages.find((message) => message.tool_calls)).toMatchObject({
        reasoning_content: "Original thought.",
        tool_calls: [{ id: "page-1" }],
      });
      expect(
        messages.filter((message) => message.role === "tool"),
      ).toMatchObject([{ tool_call_id: "page-1" }]);
      const recovered = messages.find(
        (message) =>
          message.role === "system" &&
          message.content?.includes("Internal tool replay context"),
      );
      expect(recovered?.content).toContain("Reading pages.");
      for (const page of [2, 3]) {
        expect(recovered?.content).toContain(
          `Tool input get_pages_text (page-${page})`,
        );
        expect(recovered?.content).toContain(`Page ${page} contents`);
      }
      expect(result.awaitingContinue).toBe(false);
      expect(result.assistantMessage).toContain("Final answer.");
    },
  );

  test("preserves reasoning with display hidden and replays recovered context after history reload", async () => {
    const preference: AiReasoningPreference = {
      level: "auto",
      displayPolicy: "hidden",
    };
    const first = await run(
      [
        { pages: [1] },
        { reasoning: "Exact replay text.\nSecond line.", pages: [2] },
        { reasoning: "Final reasoning." },
      ],
      { preference },
    );
    expect(
      first.updates.some((update) => update.phase === "reasoning_delta"),
    ).toBe(false);

    const restored: AiChatMessageRecord[] = JSON.parse(
      JSON.stringify(first.result.conversation),
    );
    const next = await run([{ reasoning: "Next answer reasoning." }], {
      preference,
      messages: [
        ...restored,
        { role: "user", content: "Explain those results." },
      ],
    });
    expect(
      next.requests[0].messages.find((message) => message.tool_calls),
    ).toMatchObject({
      reasoning_content: "Exact replay text.\nSecond line.",
      tool_calls: [{ id: "page-2" }],
    });
    expect(
      next.requests[0].messages.some(
        (message) =>
          message.role === "system" &&
          message.content?.includes("Page 1 contents"),
      ),
    ).toBe(true);
    expect(next.execute).not.toHaveBeenCalled();
  });

  test("leaves tool messages intact when thinking is disabled", async () => {
    const { requests } = await run([{ pages: [1] }, {}], {
      preference: { level: "none", displayPolicy: "summary" },
    });
    const call = requests[1].messages.find((message) => message.tool_calls);
    expect(call?.tool_calls).toEqual([
      expect.objectContaining({ id: "page-1" }),
    ]);
    expect(call).not.toHaveProperty("reasoning_content");
    expect(
      requests[1].messages.find((message) => message.role === "tool"),
    ).toMatchObject({
      tool_call_id: "page-1",
    });
  });
});
