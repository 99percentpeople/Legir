import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { DEFAULT_EDITOR_UI_STATE } from "@/constants";
import { aiChatService } from "@/services/ai/chat/aiChatService";
import { createAiToolRegistry } from "@/services/ai/chat/aiToolRegistry";
import type { AiToolContext } from "@/services/ai/chat/aiToolContext";
import type {
  AiChatMessageRecord,
  AiRenderedPageImageBatch,
} from "@/services/ai/chat/types";
import { createModelCapabilities } from "@/services/ai/providers/capabilities";
import { createAiConnection } from "@/services/ai/providers/connections";
import { initializeModelsDev } from "@/services/ai/providers/modelsDev";
import type { AiProviderBackendKind } from "@/services/ai/providers/catalog";

beforeAll(() => initializeModelsDev());
afterEach(() => vi.unstubAllGlobals());

const imageData =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const batch: AiRenderedPageImageBatch = {
  requestedPageCount: 1,
  returnedPageCount: 1,
  truncated: false,
  maxPagesPerCall: 4,
  pages: [
    {
      pageNumber: 2,
      pageWidth: 600,
      pageHeight: 800,
      rotation: 0,
      cropRect: { x: 20, y: 30, width: 40, height: 50 },
      pixelDensity: 1,
      renderedWidth: 40,
      renderedHeight: 50,
      mimeType: "image/png",
      renderAnnotations: true,
      base64Data: imageData,
    },
  ],
};
const input = {
  pages: [{ page: 2, rect: batch.pages[0]!.cropRect }],
  request: "Read the handwriting",
};
const streamReply = (callId?: string) =>
  new Response(
    [
      {
        delta: callId
          ? {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: callId,
                  type: "function",
                  function: {
                    name: "inspect_pages_visual",
                    arguments: JSON.stringify(input),
                  },
                },
              ],
            }
          : { role: "assistant", content: "I read the image directly." },
        finish_reason: null,
      },
      { delta: {}, finish_reason: callId ? "tool_calls" : "stop" },
    ]
      .map(
        (choice) =>
          `data: ${JSON.stringify({
            id: "reply",
            object: "chat.completion.chunk",
            created: 1,
            model: "vision-test",
            choices: [{ index: 0, ...choice }],
          })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } },
  );

const createOptions = (
  backendKind: AiProviderBackendKind,
  imageInput = true,
) => {
  const capabilities = createModelCapabilities({
    inputModalities: imageInput ? ["text", "image"] : ["text"],
    supportsToolCalls: true,
  });
  const defaults = DEFAULT_EDITOR_UI_STATE.options;
  return {
    appOptions: {
      ...defaults,
      llm: {
        account: {
          ...createAiConnection(),
          backendKind,
          apiKey: "test-key",
          apiUrl: "https://test.invalid/v1",
        },
      },
      aiChat: {
        ...defaults.aiChat,
        contextCompressionEnabled: false,
        visualModelKey: "missing:visual-model",
      },
    },
    modelKey: "account:vision-test",
    modelCache: {
      account: {
        fetchedAt: Date.now(),
        models: [{ id: "vision-test", label: "Vision test", capabilities }],
      },
    },
    capabilities,
  };
};
const createRegistry = (direct: boolean) => {
  const getPagesVisual = vi.fn(async () => batch);
  const inspectPagesVisual = vi.fn(async () => ({
    ...batch,
    summary: "Visual fallback description",
  }));
  const registry = createAiToolRegistry({
    canAttachPageVisuals: () => direct,
    getPagesVisual,
    inspectPagesVisual,
    getDocumentContext: () => ({
      currentPageNumber: 2,
      visiblePageNumbers: [2],
    }),
  } as unknown as AiToolContext);
  return { registry, getPagesVisual, inspectPagesVisual };
};

const nativeReply = (backend: AiProviderBackendKind) => {
  const text = "I read the image directly.";
  const events =
    backend === "openai"
      ? [
          {
            type: "response.created",
            response: { id: "reply", created_at: 1, model: "vision-test" },
          },
          {
            type: "response.output_item.added",
            output_index: 0,
            item: { type: "message", id: "text-1" },
          },
          {
            type: "response.output_text.delta",
            item_id: "text-1",
            delta: text,
          },
          {
            type: "response.output_item.done",
            output_index: 0,
            item: { type: "message", id: "text-1" },
          },
          {
            type: "response.completed",
            response: { usage: { input_tokens: 10, output_tokens: 5 } },
          },
        ]
      : backend === "google"
        ? [
            {
              candidates: [
                {
                  content: { role: "model", parts: [{ text }] },
                  finishReason: "STOP",
                },
              ],
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 5,
                totalTokenCount: 15,
              },
            },
          ]
        : [
            {
              type: "message_start",
              message: {
                id: "reply",
                model: "vision-test",
                role: "assistant",
                usage: { input_tokens: 10, output_tokens: 0 },
              },
            },
            {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text },
            },
            { type: "content_block_stop", index: 0 },
            {
              type: "message_delta",
              delta: { stop_reason: "end_turn" },
              usage: { output_tokens: 5 },
            },
            { type: "message_stop" },
          ];
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    {
      headers: { "Content-Type": "text/event-stream" },
    },
  );
};

describe("direct image inspection through the installed SDK", () => {
  test.each<AiProviderBackendKind>([
    "openai",
    "anthropic",
    "anthropic-compatible",
    "google",
  ])(
    "%s retains native image content through request preparation",
    async (backend) => {
      const requests: unknown[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          requests.push(JSON.parse(String(init.body)));
          return nativeReply(backend);
        }),
      );
      const { registry, inspectPagesVisual } = createRegistry(true);
      const tool = registry
        .getDefinitions()
        .find((tool) => tool.name === "inspect_pages_visual")!;
      const output = await tool.toModelOutput!({
        toolCallId: "look",
        input,
        output: batch,
      });
      const messages: AiChatMessageRecord[] = [
        { role: "user", content: "Read the page" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "look",
              toolName: "inspect_pages_visual",
              input,
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "look",
              toolName: "inspect_pages_visual",
              output,
            },
          ],
        },
      ];
      const original = structuredClone(messages);
      const result = await aiChatService.runConversation({
        ...createOptions(backend),
        messages,
        toolRegistry: registry,
      });
      expect(result.assistantMessage).toBe("I read the image directly.");
      expect(inspectPagesVisual).not.toHaveBeenCalled();
      expect(requests).toHaveLength(1);
      const requestJson = JSON.stringify(requests[0]);
      expect(requestJson.split(imageData)).toHaveLength(2);
      expect(requestJson).toContain(
        backend === "openai"
          ? '"type":"input_image"'
          : backend === "google"
            ? '"inlineData"'
            : '"type":"image"',
      );
      expect(messages).toEqual(original);
    },
  );

  test.each<AiProviderBackendKind>([
    "openai-compatible",
    "groq",
    "xai",
    "openrouter",
  ])(
    "%s sends image_url parts to the same model, without a visual intermediary or duplicated history",
    async (backend) => {
      const requests: {
        model: string;
        messages: { role: string; content: unknown }[];
      }[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          requests.push(JSON.parse(String(init.body)));
          return streamReply(
            requests.length === 1
              ? "look-1"
              : requests.length === 2
                ? "look-2"
                : undefined,
          );
        }),
      );
      const { registry, getPagesVisual, inspectPagesVisual } =
        createRegistry(true);
      const options = createOptions(backend);
      const result = await aiChatService.runConversation({
        ...options,
        messages: [{ role: "user", content: "Read this page" }],
        toolRegistry: registry,
      });
      expect(requests).toHaveLength(3);
      expect(requests.every((request) => request.model === "vision-test")).toBe(
        true,
      );
      expect(getPagesVisual).toHaveBeenCalledTimes(2);
      expect(getPagesVisual).toHaveBeenCalledWith(
        expect.objectContaining({
          pageNumbers: input.pages,
          renderAnnotations: true,
        }),
      );
      expect(inspectPagesVisual).not.toHaveBeenCalled();
      expect(result.assistantMessage).toBe("I read the image directly.");
      for (const [index, request] of requests.entries()) {
        const images = request.messages.flatMap((message) =>
          message.role === "user" && Array.isArray(message.content)
            ? message.content.filter((part) => part.type === "image_url")
            : [],
        );
        expect(images).toHaveLength(index);
        for (const image of images)
          expect(image.image_url.url).toBe(
            `data:image/png;base64,${imageData}`,
          );
        expect(
          JSON.stringify(
            request.messages.filter((message) => message.role === "tool"),
          ),
        ).not.toContain(imageData);
      }
      expect(JSON.stringify(requests[1])).toContain(
        "Cropped region x=20, y=30, width=40, height=50",
      );
      expect(
        result.conversation.filter((message) => message.role === "user"),
      ).toHaveLength(1);
      expect(JSON.stringify(result.conversation)).toContain(
        '"type":"image-data"',
      );

      await aiChatService.runConversation({
        ...options,
        messages: [
          ...result.conversation,
          { role: "user", content: "Confirm the same page." },
        ],
        toolRegistry: registry,
      });
      expect(requests).toHaveLength(4);
      expect(JSON.stringify(requests[3]).split(imageData)).toHaveLength(3);
      expect(getPagesVisual).toHaveBeenCalledTimes(2);
    },
  );

  test("a text-only model uses the existing visual fallback and never receives binary images", async () => {
    const requests: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        requests.push(JSON.parse(String(init.body)));
        return streamReply(requests.length === 1 ? "look" : undefined);
      }),
    );
    const { registry, getPagesVisual, inspectPagesVisual } =
      createRegistry(false);
    await aiChatService.runConversation({
      ...createOptions("openai-compatible", false),
      messages: [{ role: "user", content: "Read this page" }],
      toolRegistry: registry,
    });
    expect(inspectPagesVisual).toHaveBeenCalledOnce();
    expect(getPagesVisual).not.toHaveBeenCalled();
    expect(JSON.stringify(requests)).toContain("Visual fallback description");
    expect(JSON.stringify(requests)).not.toContain(imageData);
  });
});
