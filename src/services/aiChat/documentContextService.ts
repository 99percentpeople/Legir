import type {
  TextContent,
  TextItem,
  TextMarkedContent,
} from "pdfjs-dist/types/src/display/api";
import { findPdfSearchResults } from "@/lib/pdfSearch";
import { pageTranslationService } from "@/services/pageTranslationService";
import { pdfWorkerService } from "@/services/pdfService/pdfWorkerService";
import type {
  AiDocumentDigestChunk,
  AiDocumentContextService,
  AiDocumentMetadata,
  AiDocumentSnapshot,
  AiReadablePage,
  AiReadablePageLine,
  AiTextSelectionContext,
} from "./types";

const isTextItem = (item: TextItem | TextMarkedContent): item is TextItem =>
  "str" in item;

const joinPageText = (textContent: TextContent) =>
  textContent.items
    .filter(isTextItem)
    .map((item) => item.str)
    .join("");

const clampNumber = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const normalizeExcerptText = (text: string) => text.replace(/\s+/g, " ").trim();
const MAX_READ_PAGES_PER_CALL = 5;
const DIGEST_LABEL_OVERHEAD_PER_PAGE = 12;

const truncateText = (value: string, maxChars: number) => {
  const text = normalizeExcerptText(value);
  if (text.length <= maxChars) return text;
  if (maxChars <= 18) return `${text.slice(0, maxChars)}…`;
  return `${text.slice(0, Math.max(0, maxChars - 14))}…(truncated)`;
};

const sampleTextBalanced = (value: string, maxChars: number) => {
  const text = normalizeExcerptText(value);
  if (text.length <= maxChars) return text;
  if (maxChars <= 96) return truncateText(text, maxChars);

  const separator = " … ";
  const available = Math.max(0, maxChars - separator.length * 2);
  const segmentLength = Math.max(24, Math.floor(available / 3));
  const middleStart = Math.max(
    segmentLength,
    Math.floor(text.length / 2 - segmentLength / 2),
  );

  const sampled = [
    text.slice(0, segmentLength),
    text.slice(middleStart, middleStart + segmentLength),
    text.slice(Math.max(0, text.length - segmentLength)),
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(separator);

  return truncateText(sampled, maxChars);
};

const buildChunkSample = (
  pages: Array<{ pageNumber: number; text: string }>,
  totalBudget: number,
) => {
  if (pages.length === 0) return "";
  const availableBudget = Math.max(
    48,
    totalBudget - pages.length * DIGEST_LABEL_OVERHEAD_PER_PAGE,
  );
  const perPageBudget = clampNumber(
    Math.floor(availableBudget / Math.max(1, pages.length)),
    48,
    Math.max(48, availableBudget),
  );

  return pages
    .map(
      (page) =>
        `p${page.pageNumber}: ${sampleTextBalanced(page.text, perPageBudget)}`,
    )
    .join("\n");
};

const normalizeMetadataKeywords = (keywords: string | string[] | undefined) => {
  if (Array.isArray(keywords)) {
    return keywords.map((keyword) => keyword.trim()).filter(Boolean);
  }
  if (typeof keywords === "string") {
    return keywords
      .split(/[;,]/)
      .map((keyword) => keyword.trim())
      .filter(Boolean);
  }
  return [];
};

const normalizeDocumentMetadata = (
  snapshot: AiDocumentSnapshot,
): AiDocumentMetadata => ({
  title: snapshot.metadata.title?.trim() || undefined,
  author: snapshot.metadata.author?.trim() || undefined,
  subject: snapshot.metadata.subject?.trim() || undefined,
  keywords: normalizeMetadataKeywords(snapshot.metadata.keywords),
  creator: snapshot.metadata.creator?.trim() || undefined,
  producer: snapshot.metadata.producer?.trim() || undefined,
  creationDate: snapshot.metadata.creationDate || undefined,
  modificationDate: snapshot.metadata.modificationDate || undefined,
});

const clampPageNumbers = (
  pageNumbers: number[],
  totalPages: number,
  maxPages: number,
) => {
  const out: number[] = [];
  const seen = new Set<number>();

  for (const raw of pageNumbers) {
    const pageNumber = Math.trunc(raw);
    if (!Number.isFinite(pageNumber)) continue;
    if (pageNumber < 1 || pageNumber > totalPages) continue;
    if (seen.has(pageNumber)) continue;
    seen.add(pageNumber);
    out.push(pageNumber);
    if (out.length >= maxPages) break;
  }

  return out;
};

const buildPageRange = (
  startPage: number | undefined,
  endPage: number | undefined,
  totalPages: number,
) => {
  if (!Number.isFinite(startPage ?? NaN) && !Number.isFinite(endPage ?? NaN)) {
    return [];
  }

  const resolvedStart = clampNumber(
    Math.trunc(startPage ?? endPage ?? 1) || 1,
    1,
    totalPages,
  );
  const resolvedEnd = clampNumber(
    Math.trunc(endPage ?? startPage ?? resolvedStart) || resolvedStart,
    1,
    totalPages,
  );

  const lower = Math.min(resolvedStart, resolvedEnd);
  const upper = Math.max(resolvedStart, resolvedEnd);
  const out: number[] = [];
  for (let pageNumber = lower; pageNumber <= upper; pageNumber += 1) {
    out.push(pageNumber);
  }
  return out;
};

export const createDocumentContextService = (options: {
  getSnapshot: () => AiDocumentSnapshot;
  getSelectedTextContext: () => AiTextSelectionContext | null;
  getDigestConfig?: () => {
    mode?: "excerpt" | "ai_summary";
    charsPerChunk?: number;
    sourceCharsPerChunk?: number;
  };
  summarizeDigestChunk?: (options: {
    startPage: number;
    endPage: number;
    sampledText: string;
    maxChars: number;
    summaryInstructions?: string;
    signal?: AbortSignal;
  }) => Promise<string>;
}): AiDocumentContextService => {
  const {
    getSnapshot,
    getSelectedTextContext,
    getDigestConfig,
    summarizeDigestChunk,
  } = options;

  const pageTextCache = new Map<number, string>();
  const pageLinesCache = new Map<number, AiReadablePageLine[]>();

  const readPageText = async (pageIndex: number, signal?: AbortSignal) => {
    const cached = pageTextCache.get(pageIndex);
    if (typeof cached === "string") return cached;

    const textContent = await pdfWorkerService.getTextContent({
      pageIndex,
      signal,
    });
    if (!textContent) return "";

    const text = joinPageText(textContent);
    pageTextCache.set(pageIndex, text);
    return text;
  };

  const readPageLines = async (pageIndex: number, signal?: AbortSignal) => {
    const cached = pageLinesCache.get(pageIndex);
    if (cached) return cached;

    const snapshot = getSnapshot();
    const page = snapshot.pages[pageIndex];
    if (!page) return [];

    const lines = await pageTranslationService.extractLinesFromTextLayer({
      pageIndex,
      page,
      signal,
    });

    const normalized = lines.map((line) => ({
      text: line.sourceText,
      rect: line.rect,
    }));
    pageLinesCache.set(pageIndex, normalized);
    return normalized;
  };

  return {
    getDocumentContext: () => {
      const snapshot = getSnapshot();
      const selected = getSelectedTextContext();

      return {
        filename: snapshot.filename,
        pageCount: snapshot.pages.length,
        currentPageNumber:
          snapshot.pages.length > 0 ? snapshot.currentPageIndex + 1 : null,
        visiblePageNumbers:
          snapshot.pages.length > 0 ? [snapshot.currentPageIndex + 1] : [],
        selectedText: selected?.text ?? "",
        outlinePreview: snapshot.outline.slice(0, 12).map((item) => ({
          title: item.title,
          pageNumber:
            typeof item.pageIndex === "number" ? item.pageIndex + 1 : undefined,
        })),
      };
    },

    getDocumentMetadata: () => {
      const snapshot = getSnapshot();
      return normalizeDocumentMetadata(snapshot);
    },

    getDocumentDigest: async ({
      startPage,
      endPage,
      charsPerChunk,
      sourceCharsPerChunk,
      summaryInstructions,
      signal,
    }) => {
      const snapshot = getSnapshot();
      const digestConfig = getDigestConfig?.();
      const resolvedPageNumbers = buildPageRange(
        startPage,
        endPage,
        snapshot.pages.length,
      );

      const digestMode =
        digestConfig?.mode === "ai_summary" && summarizeDigestChunk
          ? "ai_summary"
          : "excerpt";
      const requestedCharsPerChunk = clampNumber(
        Math.trunc(charsPerChunk ?? digestConfig?.charsPerChunk ?? 360) || 360,
        180,
        1200,
      );
      const requestedSourceCharsPerChunk = clampNumber(
        Math.trunc(
          sourceCharsPerChunk ??
            digestConfig?.sourceCharsPerChunk ??
            requestedCharsPerChunk * 10,
        ) || requestedCharsPerChunk * 10,
        requestedCharsPerChunk,
        8_000,
      );
      const excerptCharsPerChunk = requestedCharsPerChunk;
      const effectiveSourceCharsPerChunk = clampNumber(
        Math.min(
          requestedSourceCharsPerChunk,
          Math.max(240, excerptCharsPerChunk * 12),
        ),
        excerptCharsPerChunk,
        8_000,
      );
      const pages = await Promise.all(
        resolvedPageNumbers.map(async (pageNumber) => {
          const pageText = await readPageText(pageNumber - 1, signal);
          return {
            pageNumber,
            text: normalizeExcerptText(pageText),
            charCount: pageText.length,
          };
        }),
      );
      const totalCharCount = pages.reduce(
        (sum, page) => sum + page.charCount,
        0,
      );
      const localExcerpt = buildChunkSample(pages, excerptCharsPerChunk);
      let excerpt = localExcerpt;

      if (digestMode === "ai_summary") {
        const sampledText = buildChunkSample(
          pages,
          effectiveSourceCharsPerChunk,
        );
        if (sampledText) {
          try {
            const summary = await summarizeDigestChunk({
              startPage: resolvedPageNumbers[0]!,
              endPage: resolvedPageNumbers[resolvedPageNumbers.length - 1]!,
              sampledText,
              maxChars: excerptCharsPerChunk,
              summaryInstructions,
              signal,
            });
            const normalizedSummary = normalizeExcerptText(summary);
            if (normalizedSummary) {
              excerpt = truncateText(normalizedSummary, excerptCharsPerChunk);
            }
          } catch {
            excerpt = localExcerpt;
          }
        }
      }

      const chunks: AiDocumentDigestChunk[] = [
        {
          startPage: resolvedPageNumbers[0]!,
          endPage: resolvedPageNumbers[resolvedPageNumbers.length - 1]!,
          pageCount: resolvedPageNumbers.length,
          charCount: totalCharCount,
          excerpt,
        },
      ];

      return {
        pageCount: snapshot.pages.length,
        returnedPageCount: resolvedPageNumbers.length,
        chunkCount: 1,
        mode: digestMode,
        excerptCharsPerChunk,
        sourceCharsPerChunk: effectiveSourceCharsPerChunk,
        chunks,
      };
    },

    readPages: async ({ pageNumbers, includeLayout = false, signal }) => {
      const snapshot = getSnapshot();
      const requestedPageNumbers = clampPageNumbers(
        pageNumbers,
        snapshot.pages.length,
        snapshot.pages.length,
      );
      const resolvedPageNumbers = clampPageNumbers(
        requestedPageNumbers,
        snapshot.pages.length,
        MAX_READ_PAGES_PER_CALL,
      );

      const pages = await Promise.all(
        resolvedPageNumbers.map(async (pageNumber): Promise<AiReadablePage> => {
          const pageIndex = pageNumber - 1;
          const text = await readPageText(pageIndex, signal);
          if (!includeLayout) {
            return {
              pageNumber,
              text,
              charCount: text.length,
            };
          }

          const lines = await readPageLines(pageIndex, signal);
          return {
            pageNumber,
            text,
            charCount: text.length,
            lineCount: lines.length,
            lines,
          };
        }),
      );

      return {
        requestedPageCount: requestedPageNumbers.length,
        returnedPageCount: pages.length,
        truncated: requestedPageNumbers.length > pages.length,
        maxPagesPerCall: MAX_READ_PAGES_PER_CALL,
        pages,
      };
    },

    searchDocument: async ({
      query,
      pageNumbers,
      caseSensitive = false,
      mode = "plain",
      regexFlags,
      maxResults = 20,
      signal,
    }) => {
      const snapshot = getSnapshot();
      const pageNumberCandidates =
        Array.isArray(pageNumbers) && pageNumbers.length > 0
          ? clampPageNumbers(
              pageNumbers,
              snapshot.pages.length,
              snapshot.pages.length,
            )
          : snapshot.pages.map((page) => page.pageIndex + 1);

      const allMatches = await Promise.all(
        pageNumberCandidates.map(async (pageNumber) => {
          const pageIndex = pageNumber - 1;
          const page = snapshot.pages[pageIndex];
          if (!page) return [];

          const textContent = await pdfWorkerService.getTextContent({
            pageIndex,
            signal,
          });
          if (!textContent) return [];

          return findPdfSearchResults(textContent, query, page, {
            caseSensitive,
            mode,
            regexFlags,
          });
        }),
      );

      return allMatches.flat().slice(0, Math.max(1, Math.min(50, maxResults)));
    },
  };
};
