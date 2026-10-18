import { afterEach, describe, expect, test, vi } from "vitest";
import type { TextContent } from "@/services/pdfService/engine/textTypes";

import {
  AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_DEFAULT,
  AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MAX,
  AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MIN,
} from "@/constants";
import { pageTranslationService } from "@/services/pageTranslationService";
import { createDocumentContextService } from "@/services/ai/chat/documentContextService";
import type {
  AiDocumentSnapshot,
  AiPageTextCursor,
} from "@/services/ai/chat/types";
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

afterEach(() => vi.restoreAllMocks());

describe("AI chat document context service", () => {
  test("continues inside long pages and across exact page boundaries without losing text", async () => {
    const pageTexts = [
      "a".repeat(9_999) + "😀" + "b".repeat(10_000),
      "",
      "c".repeat(10_000),
      "last",
    ];
    const service = createService({ pageTexts, maxChars: 10_000 });
    const reconstructed = pageTexts.map(() => "");
    let cursor: AiPageTextCursor | undefined;
    let calls = 0;
    do {
      const batch = await service.getPagesText({
        pageNumbers: [1, 2, 3, 4],
        cursor,
      });
      expect(batch.returnedCharCount).toBeLessThanOrEqual(10_000);
      for (const page of batch.pages) {
        expect(page.startOffset).toBe(
          reconstructed[page.pageNumber - 1]!.length,
        );
        expect(page.totalCharCount).toBe(
          pageTexts[page.pageNumber - 1]!.length,
        );
        expect(/[\uD800-\uDBFF]$/u.test(page.text)).toBe(false);
        reconstructed[page.pageNumber - 1] += page.text;
      }
      expect(batch.truncated).toBe(batch.nextCursor !== null);
      cursor = batch.nextCursor ?? undefined;
      expect(++calls).toBeLessThan(10);
    } while (cursor);
    expect(reconstructed).toEqual(pageTexts);
  });

  test("returns the next selected page after filling the budget exactly", async () => {
    const service = createService({
      pageTexts: ["a".repeat(10_000), "unused", "last"],
      maxChars: 10_000,
    });
    const first = await service.getPagesText({ pageNumbers: [1, 3] });
    expect(first.nextCursor).toEqual({ page_number: 3, char_offset: 0 });
    const last = await service.getPagesText({
      pageNumbers: [1, 3],
      cursor: first.nextCursor!,
    });
    expect(last.pages.map((page) => page.text)).toEqual(["last"]);
    expect(last.nextCursor).toBeNull();
  });

  test("layout continuation keeps text and rectangles in the same order", async () => {
    const lines = [
      {
        pageIndex: 0,
        sourceText: "a".repeat(9_990),
        rect: { x: 1, y: 10, width: 300, height: 10 },
        fontSize: 12,
        fontFamily: "Helvetica",
      },
      {
        pageIndex: 0,
        sourceText: "b".repeat(30),
        rect: { x: 1, y: 30, width: 300, height: 10 },
        fontSize: 12,
        fontFamily: "Helvetica",
      },
    ];
    vi.spyOn(
      pageTranslationService,
      "extractLinesFromTextLayer",
    ).mockResolvedValue(lines);
    const service = createService({
      pageTexts: ["raw PDF extraction may use a different order"],
      maxChars: 10_000,
    });
    const first = await service.getPagesText({
      pageNumbers: [1],
      includeLayout: true,
    });
    const last = await service.getPagesText({
      pageNumbers: [1],
      includeLayout: true,
      cursor: first.nextCursor!,
    });
    expect(first.pages[0]!.text + last.pages[0]!.text).toBe(
      lines.map((line) => line.sourceText).join("\n"),
    );
    expect(first.pages[0]!.lines?.[1]).toEqual({
      text: "b".repeat(9),
      rect: lines[1]!.rect,
    });
    expect(last.pages[0]!.lines).toEqual([
      { text: "b".repeat(21), rect: lines[1]!.rect },
    ]);
    expect(last.nextCursor).toBeNull();
  });

  test("rejects invalid continuation instead of silently skipping text", async () => {
    const service = createService({ pageTexts: ["one", "two"] });
    for (const cursor of [
      { page_number: 2, char_offset: 0 },
      { page_number: 1, char_offset: 100 },
    ]) {
      await expect(
        service.getPagesText({ pageNumbers: [1], cursor }),
      ).rejects.toThrow(/cursor/i);
    }
    const controller = new AbortController();
    controller.abort();
    await expect(
      service.getPagesText({ pageNumbers: [1], signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  test("search pages beyond the first 50 hits with an accurate total", async () => {
    const service = createService({
      pageTexts: ["hit ".repeat(40), "hit ".repeat(35), "other"],
    });
    const first = await service.searchDocument({
      query: "hit",
      maxResults: 999,
    });
    expect(first).toMatchObject({
      total: 75,
      returned: 50,
      offset: 0,
      nextOffset: 50,
      truncated: true,
    });
    const last = await service.searchDocument({
      query: "hit",
      maxResults: 999,
      offset: first.nextOffset!,
    });
    expect(last).toMatchObject({
      total: 75,
      returned: 25,
      offset: 50,
      nextOffset: null,
      truncated: false,
    });
    const ids = [...first.items, ...last.items].map((result) => result.id);
    expect(new Set(ids).size).toBe(75);
    const beyond = await service.searchDocument({ query: "hit", offset: 100 });
    expect(beyond).toMatchObject({ returned: 0, nextOffset: null, items: [] });
  });

  test("reports zoom using PDF.js percentage semantics", () => {
    const service = createService({ pageTexts: [""] });

    expect(service.getDocumentContext()).toMatchObject({
      scale: 0.75,
      zoomPercent: 75,
    });
  });

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
