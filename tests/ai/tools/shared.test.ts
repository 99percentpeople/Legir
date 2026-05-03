import { describe, expect, test } from "vitest";
import { z } from "zod";

import type { AiToolContext } from "@/services/ai/chat/aiToolContext";
import type { AiToolHandler } from "@/services/ai/chat/tools/shared";
import {
  createToolBuilder,
  createToolHandlerMap,
  defineToolModule,
  emptyObjectSchema,
  expandPageNumberSelectors,
  pageNumbersSchema,
  parseToolArgs,
  requiredPageNumbersSchema,
  summarizeListedAnnotations,
  summarizeListedFormFields,
  summarizeSearchResults,
} from "@/services/ai/chat/tools/shared";

describe("AI chat tool shared helpers", () => {
  test("parses JSON string args and normalizes camelCase keys", () => {
    const result = parseToolArgs(
      z.object({
        page_numbers: requiredPageNumbersSchema,
      }),
      JSON.stringify({ pageNumbers: ["1", 2] }),
    );

    expect(result).toEqual({
      success: true,
      data: {
        page_numbers: [1, 2],
      },
    });
  });

  test("expands page number range selectors", () => {
    expect(expandPageNumberSelectors([1, [3, 5], 5, [7, 8]])).toEqual([
      1, 3, 4, 5, 7, 8,
    ]);

    const result = parseToolArgs(
      z.object({
        page_numbers: pageNumbersSchema,
      }),
      {
        page_numbers: ["1", [3, "5"], 7],
      },
    );

    expect(result).toEqual({
      success: true,
      data: {
        page_numbers: [1, 3, 4, 5, 7],
      },
    });
  });

  test("rejects descending page number ranges", () => {
    const result = parseToolArgs(
      z.object({
        page_numbers: requiredPageNumbersSchema,
      }),
      {
        page_numbers: [[5, 3]],
      },
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("page range start");
  });

  test("repairs invalid JSON string escapes commonly produced in regex args", () => {
    const result = parseToolArgs(
      z.object({
        pattern: z.string(),
      }),
      '{"pattern":"\\s+"}',
    );

    expect(result).toEqual({
      success: true,
      data: {
        pattern: "\\s+",
      },
    });
  });

  test("formats schema errors with field paths", () => {
    const result = parseToolArgs(
      z.object({
        page_numbers: requiredPageNumbersSchema,
      }),
      { page_numbers: [] },
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("page_numbers");
  });

  test("rejects duplicate tool handlers", () => {
    const handler: AiToolHandler = {
      definition: {
        name: "get_document_context",
        description: "Read document context",
        accessType: "read",
        inputSchema: emptyObjectSchema,
      },
      execute: async () => ({
        payload: { ok: true },
        summary: "ok",
      }),
    };

    expect(() =>
      createToolHandlerMap(
        [
          defineToolModule(() => ({ get_document_context: handler })),
          defineToolModule(() => ({ get_document_context: handler })),
        ],
        {} as AiToolContext,
      ),
    ).toThrow(/Duplicate AI tool handler/);
  });

  test("tool builder returns invalid argument result instead of throwing", async () => {
    const handler = createToolBuilder("get_pages_text")
      .read()
      .description("Read page text")
      .inputSchema(
        z.object({
          page_numbers: requiredPageNumbersSchema,
        }),
      )
      .build(({ args }) => ({
        payload: { pageNumbers: args.page_numbers },
        summary: "read",
      }));

    expect(handler).toBeDefined();
    const invalid = await handler!.execute(
      { page_numbers: [] },
      {} as AiToolContext,
    );
    expect(invalid).toMatchObject({
      payload: {
        ok: false,
        error: "INVALID_ARGUMENTS",
      },
      summary: "get_pages_text failed: invalid arguments",
    });

    const valid = await handler!.execute(
      { pageNumbers: ["3"] },
      {} as AiToolContext,
    );
    expect(valid).toEqual({
      payload: { pageNumbers: [3] },
      summary: "read",
    });
  });

  test("summarizes list and search result counts", () => {
    expect(summarizeSearchResults([])).toBe("0 results");
    expect(
      summarizeSearchResults([
        {
          resultId: "result_1",
          pageNumber: 2,
          matchText: "match",
          snippet: "context",
          highlightBehavior: "exact_match_only",
          snippetPurpose: "context_only",
        },
      ]),
    ).toBe("Found 1 result, first on page 2");
    expect(summarizeListedFormFields(10, 3)).toBe("Listed 3 of 10 form fields");
    expect(summarizeListedAnnotations(1, 1)).toBe("Listed 1 annotation");
  });
});
