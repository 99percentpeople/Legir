import type { TextContent } from "pdfjs-dist/types/src/display/api";
import { isTextItem } from "@/services/pdfService/lib/textGeometry";
import type {
  PageData,
  PDFSearchDisplaySegment,
  PDFSearchResult,
} from "@/types";

export type PDFSearchMode = "plain" | "regex";

export interface PDFSearchOptions {
  caseSensitive?: boolean;
  mode?: PDFSearchMode;
  regexFlags?: string;
}

const SEARCH_CONTEXT_CHARS = 36;
const normalizePreviewText = (value: string) => value.replace(/\s+/g, " ");

const buildDisplaySegments = (
  source: string,
  startOffset: number,
  endOffset: number,
): PDFSearchDisplaySegment[] => {
  const previewStart = Math.max(0, startOffset - SEARCH_CONTEXT_CHARS);
  const previewEnd = Math.min(source.length, endOffset + SEARCH_CONTEXT_CHARS);

  const before = normalizePreviewText(source.slice(previewStart, startOffset));
  const match = normalizePreviewText(source.slice(startOffset, endOffset));
  const after = normalizePreviewText(source.slice(endOffset, previewEnd));

  const segments: PDFSearchDisplaySegment[] = [];

  if (before) {
    segments.push({
      text: previewStart > 0 ? `…${before}` : before,
      highlighted: false,
    });
  }

  if (match) {
    segments.push({ text: match, highlighted: true });
  }

  if (after) {
    segments.push({
      text: previewEnd < source.length ? `${after}…` : after,
      highlighted: false,
    });
  }

  return segments.length > 0 ? segments : [{ text: "", highlighted: false }];
};

const getPageSearchText = (textContent: TextContent) =>
  textContent.items
    .filter(isTextItem)
    .map((item) => item.str)
    .join("");

const buildRegexFlags = (caseSensitive: boolean, regexFlags?: string) => {
  return Array.from(
    new Set(
      `${(regexFlags || "").replace(/[^dgimsuvy]/g, "").replace(/[gi]/g, "")}g${caseSensitive ? "" : "i"}`,
    ),
  ).join("");
};

export const findPdfSearchResults = (
  textContent: TextContent,
  query: string,
  page: PageData,
  options?: PDFSearchOptions,
): PDFSearchResult[] => {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const pageText = getPageSearchText(textContent);
  if (!pageText) return [];

  const caseSensitive = options?.caseSensitive ?? false;
  const mode = options?.mode === "regex" ? "regex" : "plain";

  const results: PDFSearchResult[] = [];
  let matchIndexOnPage = 0;
  const pushResult = (matchOffset: number, endOffset: number) => {
    const clampedStart = Math.max(
      0,
      Math.min(pageText.length, Math.trunc(matchOffset)),
    );
    const clampedEnd = Math.max(
      0,
      Math.min(pageText.length, Math.trunc(endOffset)),
    );
    if (clampedEnd <= clampedStart) return;

    results.push({
      id: `${page.pageIndex}:${matchIndexOnPage}:${clampedStart}:${clampedEnd}`,
      pageIndex: page.pageIndex,
      matchIndexOnPage,
      startOffset: clampedStart,
      endOffset: clampedEnd,
      matchText: pageText.slice(clampedStart, clampedEnd),
      contextBefore: pageText.slice(
        Math.max(0, clampedStart - SEARCH_CONTEXT_CHARS),
        clampedStart,
      ),
      contextAfter: pageText.slice(
        clampedEnd,
        Math.min(pageText.length, clampedEnd + SEARCH_CONTEXT_CHARS),
      ),
      displaySegments: buildDisplaySegments(pageText, clampedStart, clampedEnd),
    });
    matchIndexOnPage += 1;
  };

  if (mode === "regex") {
    let pattern: RegExp;
    try {
      pattern = new RegExp(
        trimmedQuery,
        buildRegexFlags(caseSensitive, options?.regexFlags),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid regular expression.";
      throw new Error(`Invalid regex search pattern: ${message}`);
    }

    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(pageText)) !== null) {
      const matchText = match[0] ?? "";
      if (!matchText.length) {
        pattern.lastIndex += 1;
        continue;
      }

      const matchOffset = match.index ?? 0;
      const endOffset = matchOffset + matchText.length;
      pushResult(matchOffset, endOffset);
    }
  } else {
    const normalizedPageText = caseSensitive
      ? pageText
      : pageText.toLocaleLowerCase();
    const normalizedQuery = caseSensitive
      ? trimmedQuery
      : trimmedQuery.toLocaleLowerCase();
    if (!normalizedQuery.trim()) return [];

    let cursor = 0;
    while (cursor < normalizedPageText.length) {
      const matchOffset = normalizedPageText.indexOf(normalizedQuery, cursor);
      if (matchOffset === -1) break;

      const endOffset = matchOffset + trimmedQuery.length;
      pushResult(matchOffset, endOffset);
      cursor = matchOffset + Math.max(1, normalizedQuery.length);
    }
  }

  return results.sort((a, b) => {
    return a.startOffset - b.startOffset;
  });
};
