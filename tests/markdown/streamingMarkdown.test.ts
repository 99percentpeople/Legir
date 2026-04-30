import { describe, expect, test } from "vitest";

import {
  buildStreamingSpecialBlockViewModel,
  splitMarkdownStream,
} from "@/components/markdown/lib/streamingMarkdown";

describe("streaming markdown code blocks", () => {
  test("renders unfinished fenced code blocks as structured streaming blocks", () => {
    const block = buildStreamingSpecialBlockViewModel(
      "```ts\nconst value = 1;",
      null,
      true,
    );

    expect(block).toMatchObject({
      kind: "code",
      viewModel: {
        code: "const value = 1;",
        language: "ts",
      },
    });
  });

  test("hides partial closing fences from streaming code content", () => {
    const block = buildStreamingSpecialBlockViewModel(
      "```ts\nconst value = 1;\n``",
      null,
      true,
    );

    expect(block).toMatchObject({
      kind: "code",
      viewModel: {
        code: "const value = 1;\n",
      },
    });
  });

  test("keeps short marker lines once they are completed code lines", () => {
    const block = buildStreamingSpecialBlockViewModel(
      "```ts\nconst value = 1;\n``\n",
      null,
      true,
    );

    expect(block).toMatchObject({
      kind: "code",
      viewModel: {
        code: "const value = 1;\n``\n",
      },
    });
  });

  test("commits complete fenced code blocks instead of treating them as pending", () => {
    const split = splitMarkdownStream("```ts\nconst value = 1;\n```\n", {
      streaming: true,
    });

    expect(split.pendingSource).toBe("");
    expect(split.stableBlocks).toEqual(["```ts\nconst value = 1;\n```\n"]);
  });
});
