import { describe, expect, test } from "vitest";
import {
  compressVisualToolHistoryForModel,
  limitVisualToolImagesForModel,
} from "@/services/ai/chat/runtime/imageCompression";
import { AI_CHAT_PAGE_IMAGE_MAX_BYTES } from "@/constants";
import { readPageImageDimensions } from "@/services/ai/chat/pageImageLimits";
import type { AiChatMessageRecord } from "@/services/ai/chat/types";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const messages = (count: number): AiChatMessageRecord[] => [
  {
    role: "tool",
    content: Array.from({ length: count }, (_, i) => ({
      type: "tool-result",
      toolCallId: `look-${i}`,
      toolName: "inspect_pages_visual",
      output: {
        type: "content",
        value: [
          {
            type: "text",
            text: `page ${i + 1}, crop 10,20,40,50, document d_test`,
          },
          { type: "image-data", data: png, mediaType: "image/png" },
        ],
      },
    })),
  },
];

describe("request image budgets", () => {
  test("keeps only the newest four images across parallel calls without mutating history or dropping metadata", () => {
    const source = messages(8);
    const before = structuredClone(source);
    const limited = limitVisualToolImagesForModel(source);
    expect(source).toEqual(before);
    expect(JSON.stringify(limited).split(png)).toHaveLength(5);
    expect(limitVisualToolImagesForModel(limited)).toBe(limited);
    const content = limited[0]!.content as Exclude<
      (typeof limited)[number]["content"],
      string
    >;
    for (let i = 0; i < 8; i++) {
      const part = content[i]!;
      expect(JSON.stringify(part)).toContain(
        `page ${i + 1}, crop 10,20,40,50, document d_test`,
      );
      expect(JSON.stringify(part).includes(png)).toBe(i >= 4);
    }
  });

  test("still applies hard count limits when all visual history is requested", async () => {
    const source = [
      ...messages(4),
      { role: "user" as const, content: "continue" },
      ...messages(2),
    ];
    const prepared = await compressVisualToolHistoryForModel({
      messages: source,
      keepWindow: 100,
    });
    expect(JSON.stringify(prepared).split(png)).toHaveLength(5);
    expect(JSON.stringify(source).split(png)).toHaveLength(7);
  });

  test("removes 5000x3000 historical PNGs and excessive encoded bytes without bitmap decoding", () => {
    const raw = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
    new DataView(raw.buffer).setUint32(16, 5000);
    new DataView(raw.buffer).setUint32(20, 3000);
    const huge = btoa(String.fromCharCode(...raw));
    for (const data of [
      huge,
      "A".repeat(4 * Math.ceil((AI_CHAT_PAGE_IMAGE_MAX_BYTES + 3) / 3)),
      "broken",
    ]) {
      const source = messages(1);
      const serialized = JSON.parse(
        JSON.stringify(source).replace(png, data),
      ) as AiChatMessageRecord[];
      const result = limitVisualToolImagesForModel(serialized);
      expect(JSON.stringify(result)).not.toContain('"type":"image-data"');
      expect(JSON.stringify(result)).toContain(
        "call inspect_pages_visual again",
      );
      expect(JSON.stringify(serialized)).toContain('"type":"image-data"');
    }
  });

  test("recognizes PNG and JPEG dimensions without a canvas", () => {
    const raw = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
    expect(readPageImageDimensions(raw)).toEqual({ width: 1, height: 1 });
    // JPEG SOF0: precision 8, height 300, width 500, one component.
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 1, 44, 1, 244, 1, 1, 0x11, 0,
    ]);
    expect(readPageImageDimensions(jpeg)).toEqual({ width: 500, height: 300 });
    expect(readPageImageDimensions(jpeg.slice(0, 7))).toBeNull();
  });
});
