import { describe, expect, test } from "vitest";

import type { AiToolContext } from "@/services/ai/chat/aiToolContext";
import type {
  AiReadablePageBatch,
  AiRenderedPageImageBatch,
} from "@/services/ai/chat/types";
import { documentToolModule } from "@/services/ai/chat/tools/documentTools";
import { createToolHandlerMap } from "@/services/ai/chat/tools/shared";

const createBatch = (
  overrides: Partial<AiReadablePageBatch> = {},
): AiReadablePageBatch => ({
  requestedPageCount: 1,
  returnedPageCount: 1,
  returnedCharCount: 123,
  truncated: false,
  maxCharsPerCall: 20_000,
  pages: [
    {
      pageNumber: 1,
      text: "text",
      charCount: 4,
    },
  ],
  ...overrides,
});

const createVisualBatch = (
  overrides: Partial<AiRenderedPageImageBatch> = {},
): AiRenderedPageImageBatch => ({
  requestedPageCount: 0,
  returnedPageCount: 0,
  truncated: false,
  maxPagesPerCall: 4,
  pages: [],
  ...overrides,
});

describe("AI chat document tools", () => {
  test("get_pages_text delegates to getPagesText", async () => {
    const calls: unknown[] = [];
    const ctx = {
      getPagesText: async (input: unknown) => {
        calls.push(input);
        return createBatch();
      },
    } as unknown as AiToolContext;
    const handlers = createToolHandlerMap([documentToolModule], ctx);
    const handler = handlers.get_pages_text;

    expect(handler).toBeDefined();
    expect(handler!.definition.description).toContain("AI chat settings");

    const result = await handler!.execute(
      {
        pageNumbers: ["1", [3, 5]],
        includeLayout: true,
      },
      ctx,
    );

    expect(calls).toEqual([
      {
        pageNumbers: [1, 3, 4, 5],
        includeLayout: true,
        signal: undefined,
      },
    ]);
    expect(result.payload).toEqual(createBatch());
    expect(result.summary).toBe("Read 123 chars from 1 page");
  });

  test("get_pages_text summarizes configured character truncation", async () => {
    const ctx = {
      getPagesText: async () =>
        createBatch({
          requestedPageCount: 4,
          returnedPageCount: 2,
          returnedCharCount: 20_000,
          truncated: true,
          maxCharsPerCall: 20_000,
        }),
    } as unknown as AiToolContext;
    const handlers = createToolHandlerMap([documentToolModule], ctx);

    const result = await handlers.get_pages_text!.execute(
      { page_numbers: [1, 2, 3, 4] },
      ctx,
    );

    expect(result.summary).toContain("from 2 of 4 requested pages");
    expect(result.summary).toContain("truncated at");
    expect(result.summary).toContain("chars");
  });

  test("get_pages_text does not accept per-call max_chars", async () => {
    const ctx = {
      getPagesText: async () => createBatch(),
    } as unknown as AiToolContext;
    const handlers = createToolHandlerMap([documentToolModule], ctx);

    const result = await handlers.get_pages_text!.execute(
      {
        page_numbers: [1],
        max_chars: 1_000,
      },
      ctx,
    );

    expect(result).toMatchObject({
      payload: {
        ok: false,
        error: "INVALID_ARGUMENTS",
      },
      summary: "get_pages_text failed: invalid arguments",
    });
  });

  test("get_pages_visual expands full-page ranges and keeps crop targets", async () => {
    const cropTarget = {
      page: 5,
      rect: { x: 0, y: 0, width: 10, height: 10 },
    };
    const calls: unknown[] = [];
    const ctx = {
      getDocumentContext: () => ({
        currentPageNumber: null,
        visiblePageNumbers: [],
      }),
      getPagesVisual: async (input: unknown) => {
        calls.push(input);
        return createVisualBatch();
      },
    } as unknown as AiToolContext;
    const handlers = createToolHandlerMap([documentToolModule], ctx);

    await handlers.get_pages_visual!.execute(
      {
        pages: [[1, 3], cropTarget],
        render_annotations: false,
      },
      ctx,
    );

    expect(calls).toEqual([
      {
        pageNumbers: [1, 2, 3, cropTarget],
        renderAnnotations: false,
        signal: undefined,
      },
    ]);
  });
});
