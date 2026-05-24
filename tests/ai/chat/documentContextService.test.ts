import { describe, expect, test } from "vitest";
import type { TextContent } from "pdfjs-dist/types/src/display/api";

import {
  AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_DEFAULT,
  AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MAX,
  AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MIN,
} from "@/constants";
import { createDocumentContextService } from "@/services/ai/chat/documentContextService";
import type { AiDocumentSnapshot } from "@/services/ai/chat/types";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";

const createSnapshot = (pageCount: number): AiDocumentSnapshot => ({
  filename: "test.pdf",
  metadata: {},
  documentPermissions: null,
  sourceDocumentPermissions: null,
  pdfOwnerUnlocked: false,
  preservePdfOwnerRestrictionsOnSave: true,
  pages: Array.from({ length: pageCount }, (_, pageIndex) => ({
    pageIndex,
    width: 0,
    height: 0,
    viewBox: [0, 0, 0, 0],
    userUnit: 1,
    rotation: 0,
  })),
  outline: [],
  currentPageIndex: 0,
  scale: 1,
  pageLayout: "single",
  pageFlow: "vertical",
});

const createTextContent = (text: string): TextContent =>
  ({
    items: [{ str: text }],
    styles: {},
  }) as unknown as TextContent;

const createService = (options: { pageTexts: string[]; maxChars?: number }) =>
  createDocumentContextService({
    getSnapshot: () => createSnapshot(options.pageTexts.length),
    getSelectedTextContext: () => null,
    getPagesTextConfig: () => ({ maxChars: options.maxChars }),
    workerService: {
      getTextContent: async ({ pageIndex }: { pageIndex: number }) =>
        createTextContent(options.pageTexts[pageIndex] ?? ""),
    } as unknown as PDFWorkerService,
  });

describe("AI chat document context service", () => {
  test("getPagesText truncates by configured character budget", async () => {
    const firstPage = "a".repeat(6_000);
    const secondPage = "b".repeat(7_000);
    const service = createService({
      pageTexts: [firstPage, secondPage, "c"],
      maxChars: AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MIN,
    });

    const result = await service.getPagesText({
      pageNumbers: [1, 2, 3],
    });

    expect(result).toMatchObject({
      requestedPageCount: 3,
      returnedPageCount: 2,
      returnedCharCount: AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MIN,
      truncated: true,
      maxCharsPerCall: AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MIN,
    });
    expect(result.pages.map((page) => page.text)).toEqual([
      firstPage,
      secondPage.slice(0, 4_000),
    ]);
    expect(result.pages[1]?.truncated).toBe(true);
  });

  test("getPagesText can return more than the old page-count cap", async () => {
    const pageTexts = Array.from({ length: 12 }, () => "x");
    const service = createService({
      pageTexts,
      maxChars: 1_000,
    });

    const result = await service.getPagesText({
      pageNumbers: pageTexts.map((_, index) => index + 1),
    });

    expect(result.returnedPageCount).toBe(12);
    expect(result.returnedCharCount).toBe(12);
    expect(result.truncated).toBe(false);
  });

  test("getPagesText clamps configured character budget", async () => {
    const fallbackService = createService({
      pageTexts: ["x"],
      maxChars: 0,
    });
    const maxService = createService({
      pageTexts: ["x"],
      maxChars: Number.MAX_SAFE_INTEGER,
    });

    await expect(
      fallbackService.getPagesText({ pageNumbers: [1] }),
    ).resolves.toMatchObject({
      maxCharsPerCall: AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_DEFAULT,
    });
    await expect(
      maxService.getPagesText({ pageNumbers: [1] }),
    ).resolves.toMatchObject({
      maxCharsPerCall: AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MAX,
    });
  });
});
