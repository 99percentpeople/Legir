import { describe, expect, test } from "vitest";
import type { ModelMessage } from "ai";
import { prepareToolImageMessages } from "@/services/ai/chat/runtime/toolImages";

const toolResult = (id: string, page: number): ModelMessage => ({
  role: "tool",
  content: [
    {
      type: "tool-result",
      toolName: "inspect_pages_visual",
      toolCallId: id,
      output: {
        type: "content",
        value: [
          {
            type: "text",
            text: `Page ${page}, crop x=20,y=30,width=40,height=50`,
          },
          {
            type: "image-data",
            data: `image-${page}`,
            mediaType: "image/png",
            providerOptions: { openai: { imageDetail: "low" } },
          },
        ],
      },
    },
  ],
});

describe("image tool transport projection", () => {
  test("keeps parallel tool results together, preserves geometry and image options, and does not change history", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Compare both documents." },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "a",
            toolName: "inspect_pages_visual",
            input: { document_id: "doc-a" },
          },
          {
            type: "tool-call",
            toolCallId: "b",
            toolName: "inspect_pages_visual",
            input: { document_id: "doc-b" },
          },
        ],
      },
      toolResult("a", 1),
      toolResult("b", 2),
      { role: "assistant", content: "Compared both pages." },
    ];
    const original = structuredClone(messages);
    const options = {
      supportsImageInput: true,
      supportsImageToolResults: false,
    };
    const projected = prepareToolImageMessages(messages, options);
    expect(messages).toEqual(original);
    expect(projected.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
      "user",
      "assistant",
    ]);
    expect(JSON.stringify(projected.slice(2, 4))).not.toContain("image-1");
    expect(JSON.stringify(projected.slice(2, 4))).not.toContain("image-2");
    expect(projected[4]).toMatchObject({
      content: [
        { type: "text", text: expect.stringContaining("call a") },
        { type: "text", text: expect.stringContaining("Page 1, crop x=20") },
        {
          type: "image",
          image: "image-1",
          mediaType: "image/png",
          providerOptions: { openai: { imageDetail: "low" } },
        },
        { type: "text", text: expect.stringContaining("call b") },
        { type: "text", text: expect.stringContaining("Page 2, crop x=20") },
        { type: "image", image: "image-2" },
      ],
    });
    expect(prepareToolImageMessages(projected, options)).toBe(projected);
  });

  test("native transports retain image tool results", () => {
    const messages = [toolResult("a", 1)];
    expect(
      prepareToolImageMessages(messages, {
        supportsImageInput: true,
        supportsImageToolResults: true,
      }),
    ).toBe(messages);
  });

  test("switching to a text-only model removes binary image data and retains page metadata", () => {
    const messages = [toolResult("a", 1)];
    const projected = prepareToolImageMessages(messages, {
      supportsImageInput: false,
      supportsImageToolResults: true,
    });
    expect(projected).toHaveLength(1);
    const output = JSON.stringify(projected);
    expect(output).not.toContain("image-1");
    expect(output).toContain("Page 1, crop x=20");
    expect(output).toContain("does not support image input");
    expect(JSON.stringify(messages)).toContain("image-1");
  });
});
