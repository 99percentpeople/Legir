import { describe, expect, test } from "vitest";

import type { AiToolContext } from "@/services/ai/chat/aiToolContext";
import { createAiToolRegistry } from "@/services/ai/chat/aiToolRegistry";
import type {
  AiDocumentMetadata,
  AiReadablePageBatch,
  AiRenderedPageImageBatch,
} from "@/services/ai/chat/types";
import { documentToolModule } from "@/services/ai/chat/tools/documentTools";
import { createToolHandlerMap } from "@/services/ai/chat/tools/shared";
import type { LLMModelCapabilities } from "@/types";

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

const createCapabilities = (
  overrides: Partial<LLMModelCapabilities> = {},
): LLMModelCapabilities => ({
  inputModalities: ["text", "image"],
  outputModalities: ["text"],
  supportsImageInput: true,
  supportsToolCalls: true,
  supportsImageToolResults: false,
  contextWindowTokens: 128_000,
  ...overrides,
});

describe("AI chat document tools", () => {
  test("get_document_metadata returns a single current permissions field", async () => {
    const metadata: AiDocumentMetadata = {
      filename: "restricted.pdf",
      title: "Restricted",
      keywords: [],
      permissions: {
        hasOwnerRestrictions: true,
        canModifyContents: false,
      } as AiDocumentMetadata["permissions"],
      ownerRestrictionsUnlocked: false,
      preserveOwnerRestrictionsOnSave: true,
    };
    const ctx = {
      getDocumentMetadata: () => metadata,
    } as unknown as AiToolContext;
    const handlers = createToolHandlerMap([documentToolModule], ctx);
    const handler = handlers.get_document_metadata;

    expect(handler).toBeDefined();

    const result = await handler!.execute({}, ctx);

    expect(result.payload).toEqual(metadata);
    expect(result.payload).not.toHaveProperty("sourcePermissions");
    expect(result.summary).toBe(
      "Metadata with 2 populated fields; permissions restricted",
    );
  });

  test("update_document_metadata delegates normalized metadata updates", async () => {
    const calls: unknown[] = [];
    const ctx = {
      updateDocumentMetadata: (input: unknown) => {
        calls.push(input);
        return {
          ok: true,
          status: "updated",
          updatedFields: ["title", "keywords", "producer"],
          metadata: {
            title: "Updated title",
            keywords: ["contract", "signed"],
            producer: "Legir",
            isProducerManual: true,
          },
        };
      },
    } as unknown as AiToolContext;
    const handlers = createToolHandlerMap([documentToolModule], ctx);
    const handler = handlers.update_document_metadata;

    expect(handler).toBeDefined();
    expect(handler!.definition.accessType).toBe("write");

    const result = await handler!.execute(
      {
        title: "Updated title",
        keywords: "contract; signed",
        producer: "Legir",
      },
      ctx,
    );

    expect(calls).toEqual([
      {
        title: "Updated title",
        keywords: ["contract", "signed"],
        producer: "Legir",
        isProducerManual: true,
      },
    ]);
    expect(result).toMatchObject({
      payload: {
        ok: true,
        status: "updated",
        updatedFields: ["title", "keywords", "producer"],
      },
      summary: "Updated document metadata: title, keywords, producer",
    });
  });

  test("unlock_pdf_permissions delegates to the shared unlock context", async () => {
    const calls: unknown[] = [];
    const ctx = {
      unlockPdfPermissions: async (input: unknown) => {
        calls.push(input);
        return {
          ok: true,
          status: "unlocked",
          unlocked: true,
          permissions: { hasOwnerRestrictions: false },
          sourcePermissions: { hasOwnerRestrictions: true },
          preserveOwnerRestrictionsOnSave: false,
        };
      },
    } as unknown as AiToolContext;
    const handlers = createToolHandlerMap([documentToolModule], ctx);
    const handler = handlers.unlock_pdf_permissions;

    expect(handler).toBeDefined();
    expect(handler!.definition.accessType).toBe("write");

    const result = await handler!.execute(
      {
        password: "owner secret",
        preserve_owner_restrictions_on_save: false,
      },
      ctx,
    );

    expect(calls).toEqual([
      {
        password: "owner secret",
        preserveOwnerRestrictionsOnSave: false,
      },
    ]);
    expect(result).toMatchObject({
      payload: {
        ok: true,
        status: "unlocked",
        unlocked: true,
        preserveOwnerRestrictionsOnSave: false,
      },
      summary: "PDF permissions unlocked",
    });
  });

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

  test("inspect_pages_visual expands full-page ranges and keeps crop targets", async () => {
    const cropTarget = {
      page: 5,
      rect: { x: 0, y: 0, width: 10, height: 10 },
    };
    const calls: unknown[] = [];
    const ctx = {
      canAttachPageVisuals: () => true,
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

    await handlers.inspect_pages_visual!.execute(
      {
        pages: [[1, 3], cropTarget],
      },
      ctx,
    );

    expect(calls).toEqual([
      {
        pageNumbers: [1, 2, 3, cropTarget],
        renderAnnotations: true,
        signal: undefined,
      },
    ]);
  });

  test("inspect_pages_visual is available for direct image or visual model paths", () => {
    const withoutVisualPath = createAiToolRegistry(
      {
        canAttachPageVisuals: () => false,
      } as unknown as AiToolContext,
      {
        modelCapabilities: createCapabilities({
          supportsImageToolResults: false,
        }),
      },
    );
    const withDirectImagePath = createAiToolRegistry(
      {
        canAttachPageVisuals: () => true,
      } as unknown as AiToolContext,
      {
        modelCapabilities: createCapabilities({
          supportsImageToolResults: true,
        }),
      },
    );
    const withVisualModelPath = createAiToolRegistry(
      {
        canAttachPageVisuals: () => false,
        inspectPagesVisual: async () => ({
          requestedPageCount: 1,
          returnedPageCount: 1,
          truncated: false,
          maxPagesPerCall: 4,
          pages: [],
          summary: "summary",
        }),
      } as unknown as AiToolContext,
      {
        modelCapabilities: createCapabilities({
          supportsImageToolResults: false,
        }),
      },
    );

    expect(
      withoutVisualPath
        .getDefinitions()
        .some((definition) => definition.name === "inspect_pages_visual"),
    ).toBe(false);
    expect(
      withDirectImagePath
        .getDefinitions()
        .some((definition) => definition.name === "inspect_pages_visual"),
    ).toBe(true);
    expect(
      withVisualModelPath
        .getDefinitions()
        .some((definition) => definition.name === "inspect_pages_visual"),
    ).toBe(true);
  });

  test("inspect_pages_visual rejects removed summary instructions", async () => {
    const calls: unknown[] = [];
    const ctx = {
      canAttachPageVisuals: () => false,
      getDocumentContext: () => ({
        currentPageNumber: 1,
        visiblePageNumbers: [1],
      }),
      inspectPagesVisual: async (input: unknown) => {
        calls.push(input);
        return {
          requestedPageCount: 1,
          returnedPageCount: 1,
          truncated: false,
          maxPagesPerCall: 4,
          pages: [],
          summary: "summary",
        };
      },
    } as unknown as AiToolContext;
    const handlers = createToolHandlerMap([documentToolModule], ctx);

    const result = await handlers.inspect_pages_visual!.execute(
      {
        pages: [1],
        summary_instructions: {
          what_to_add_or_verify: "old argument",
        },
      },
      ctx,
    );

    expect(calls).toEqual([]);
    expect(result).toMatchObject({
      payload: {
        ok: false,
        error: "INVALID_ARGUMENTS",
      },
      summary: "inspect_pages_visual failed: invalid arguments",
    });
  });

  test("inspect_pages_visual forwards visual structure request", async () => {
    const calls: unknown[] = [];
    const ctx = {
      canAttachPageVisuals: () => false,
      getDocumentContext: () => ({
        currentPageNumber: 1,
        visiblePageNumbers: [1],
      }),
      inspectPagesVisual: async (input: unknown) => {
        calls.push(input);
        return {
          requestedPageCount: 1,
          returnedPageCount: 1,
          truncated: false,
          maxPagesPerCall: 4,
          request: "Locate the signature line and return a page-space box",
          pages: [],
          summary:
            '<page n="1" w="100" h="200"><region id="r1" type="signature" box="70,160,20,10"><desc>Signature line</desc></region></page>',
        };
      },
    } as unknown as AiToolContext;
    const handlers = createToolHandlerMap([documentToolModule], ctx);

    const result = await handlers.inspect_pages_visual!.execute(
      {
        pages: [1],
        request: "  Locate the signature line and return a page-space box  ",
      },
      ctx,
    );

    expect(calls).toEqual([
      {
        pageNumbers: [1],
        renderAnnotations: true,
        request: "Locate the signature line and return a page-space box",
        signal: undefined,
      },
    ]);
    expect(result.payload).toMatchObject({
      kind: "visual_analysis",
      request: "Locate the signature line and return a page-space box",
    });
    expect(result.modelOutput).toContain('type="signature"');
  });

  test("inspect_pages_visual uses visual structure for form-like requests", async () => {
    const calls: unknown[] = [];
    const ctx = {
      canAttachPageVisuals: () => false,
      getDocumentContext: () => ({
        currentPageNumber: 2,
        visiblePageNumbers: [2],
      }),
      inspectPagesVisual: async (input: unknown) => {
        calls.push(input);
        return {
          requestedPageCount: 1,
          returnedPageCount: 1,
          truncated: false,
          maxPagesPerCall: 4,
          request: "Find form-like regions with labels and boxes",
          pages: [],
          summary:
            '<page n="2" w="100" h="200"><region id="r1" type="form" box="1,2,30,10" conf="0.8"><text>Name</text><desc>Likely text field.</desc></region></page>',
        };
      },
    } as unknown as AiToolContext;
    const handlers = createToolHandlerMap([documentToolModule], ctx);

    const result = await handlers.inspect_pages_visual!.execute(
      {
        pages: [2],
        request: "Find form-like regions with labels and boxes",
      },
      ctx,
    );

    expect(calls).toEqual([
      {
        pageNumbers: [2],
        renderAnnotations: true,
        request: "Find form-like regions with labels and boxes",
        signal: undefined,
      },
    ]);
    expect(result).toMatchObject({
      payload: {
        kind: "visual_analysis",
        request: "Find form-like regions with labels and boxes",
      },
    });
    expect(result.modelOutput).toContain('type="form"');
  });
});
