import { getPageImageRenderPlan } from "./pageImageLimits";
import { paginateAiResults } from "./pagination";
import {
  AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_DEFAULT,
  AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MAX,
  AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MIN,
  AI_CHAT_PAGE_IMAGE_MAX_BYTES,
  AI_CHAT_MAX_PAGE_IMAGES_PER_CALL,
} from "@/constants";
import { convertUint8ArrayToBase64 } from "@ai-sdk/provider-utils";
import { findPdfSearchResults, type PDFSearchMode } from "@/lib/pdfSearch";
import { getEffectivePdfPermissions } from "@/lib/pdfPermissions";
import {
  workspaceScaleToPdfViewerScale,
  workspaceScaleToZoomPercent,
} from "@/lib/pdfScale";
import { pageTranslationService } from "@/services/pageTranslationService";
import { createViewportFromPageInfo } from "@/services/pdfService/lib/coords";
import {
  pdfWorkerService,
  type PDFWorkerService,
} from "@/services/pdfService/pdfWorkerService";
import { roundAiRect } from "@/services/ai/utils/geometry";
import { serializePageTextContent } from "@/services/ai/utils/pageTextSerialization";
import type {
  AiDocumentMetadata,
  AiDocumentViewportPageRect,
  AiPageSpaceRect,
  AiRenderedPageImage,
  AiRenderedPageImageBatch,
  AiRenderedPageVisualSummaryResult,
  AiDocumentSnapshot,
  AiReadablePage,
  AiReadablePageBatch,
  AiPageTextCursor,
  AiReadablePageLine,
  AiTextSelectionContext,
} from "./types";

const clampNumber = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const clampGetPagesTextMaxChars = (value: unknown) => {
  const next = Math.trunc(Number(value) || 0);
  if (!Number.isFinite(next) || next <= 0) {
    return AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_DEFAULT;
  }
  return clampNumber(
    next,
    AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MIN,
    AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MAX,
  );
};

const toAbortError = () => {
  if (typeof DOMException === "function") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
};

const throwIfAborted = (signal?: AbortSignal) => {
  signal?.throwIfAborted?.();
  if (signal?.aborted) {
    throw toAbortError();
  }
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
  filename: snapshot.filename,
  title: snapshot.metadata.title?.trim() || undefined,
  author: snapshot.metadata.author?.trim() || undefined,
  subject: snapshot.metadata.subject?.trim() || undefined,
  keywords: normalizeMetadataKeywords(snapshot.metadata.keywords),
  creator: snapshot.metadata.creator?.trim() || undefined,
  producer: snapshot.metadata.producer?.trim() || undefined,
  creationDate: snapshot.metadata.creationDate || undefined,
  modificationDate: snapshot.metadata.modificationDate || undefined,
  permissions: getEffectivePdfPermissions(snapshot.documentPermissions),
  ownerRestrictionsUnlocked: snapshot.pdfOwnerUnlocked,
  preserveOwnerRestrictionsOnSave: snapshot.preservePdfOwnerRestrictionsOnSave,
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

const parseWorkspacePageNumber = (value: string) => {
  const pageIndex = Number.parseInt(value.replace(/^page-/, ""), 10);
  if (!Number.isFinite(pageIndex) || pageIndex < 0) return null;
  return pageIndex + 1;
};

const getVisibleWorkspacePageNumbers = (
  totalPages: number,
  root?: ParentNode | null,
) => {
  if (typeof document === "undefined" || totalPages <= 0) return [];

  const scrollContainer = (root === undefined ? document : root)?.querySelector(
    '[data-workspace-scroll-container="true"]',
  );
  if (!(scrollContainer instanceof HTMLElement)) return [];

  const containerRect = scrollContainer.getBoundingClientRect();
  if (containerRect.width <= 0 || containerRect.height <= 0) return [];

  const visiblePageNumbers = new Set<number>();
  for (const pageElement of scrollContainer.querySelectorAll<HTMLElement>(
    '[id^="page-"]',
  )) {
    const pageNumber = parseWorkspacePageNumber(pageElement.id);
    if (!pageNumber || pageNumber > totalPages) continue;

    const rect = pageElement.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.right <= containerRect.left ||
      rect.left >= containerRect.right ||
      rect.bottom <= containerRect.top ||
      rect.top >= containerRect.bottom
    ) {
      continue;
    }

    visiblePageNumbers.add(pageNumber);
  }

  return Array.from(visiblePageNumbers).sort((left, right) => left - right);
};

type PageVisualRequest = number | { page: number; rect: AiPageSpaceRect };
type ResolvedPageVisualRequest = {
  pageNumber: number;
  cropRect?: AiPageSpaceRect;
};
const buildPageViewport = (page: AiDocumentSnapshot["pages"][number]) =>
  createViewportFromPageInfo(
    {
      viewBox: page.viewBox,
      userUnit: page.userUnit,
      rotation: page.rotation,
    },
    {
      scale: 1,
      rotation: page.rotation,
    },
  );

const clampPageSpaceRectToBounds = (
  pageWidth: number,
  pageHeight: number,
  rect: AiPageSpaceRect,
): AiPageSpaceRect | null => {
  if (
    ![pageWidth, pageHeight, rect.x, rect.y, rect.width, rect.height].every(
      Number.isFinite,
    ) ||
    pageWidth <= 0 ||
    pageHeight <= 0 ||
    rect.width <= 0 ||
    rect.height <= 0
  )
    return null;
  const left = clampNumber(rect.x, 0, pageWidth);
  const top = clampNumber(rect.y, 0, pageHeight);
  const right = clampNumber(rect.x + rect.width, 0, pageWidth);
  const bottom = clampNumber(rect.y + rect.height, 0, pageHeight);

  if (right <= left || bottom <= top) {
    return null;
  }

  return roundAiRect({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
};

const buildResolvedPageVisualRequestSignature = (
  request: ResolvedPageVisualRequest,
) =>
  request.cropRect
    ? [
        request.pageNumber,
        request.cropRect.x,
        request.cropRect.y,
        request.cropRect.width,
        request.cropRect.height,
      ].join(":")
    : `${request.pageNumber}:full`;

const resolvePageVisualRequests = (
  requests: PageVisualRequest[],
  snapshot: AiDocumentSnapshot,
  maxRequests = Number.POSITIVE_INFINITY,
) => {
  const resolved: ResolvedPageVisualRequest[] = [];
  const seen = new Set<string>();

  for (const rawRequest of requests) {
    const rawPageNumber =
      typeof rawRequest === "number" ? rawRequest : rawRequest.page;
    const pageNumber = Math.trunc(rawPageNumber);
    if (!Number.isFinite(pageNumber)) continue;
    if (pageNumber < 1 || pageNumber > snapshot.pages.length) continue;

    const page = snapshot.pages[pageNumber - 1];
    if (!page) continue;

    const viewport = buildPageViewport(page);
    const cropRect =
      typeof rawRequest === "number"
        ? undefined
        : clampPageSpaceRectToBounds(
            viewport.width,
            viewport.height,
            rawRequest.rect,
          );
    if (typeof rawRequest !== "number" && !cropRect) continue;

    const request: ResolvedPageVisualRequest = cropRect
      ? { pageNumber, cropRect }
      : { pageNumber };
    const signature = buildResolvedPageVisualRequestSignature(request);
    if (seen.has(signature)) continue;
    seen.add(signature);
    resolved.push(request);

    if (resolved.length >= maxRequests) {
      break;
    }
  }

  return resolved;
};

const getWorkspaceViewportPageRects = (
  snapshot: AiDocumentSnapshot,
  root?: ParentNode | null,
): AiDocumentViewportPageRect[] => {
  if (typeof document === "undefined" || snapshot.pages.length === 0) {
    return [];
  }

  const scrollContainer = (root === undefined ? document : root)?.querySelector(
    '[data-workspace-scroll-container="true"]',
  );
  if (!(scrollContainer instanceof HTMLElement)) return [];

  const containerRect = scrollContainer.getBoundingClientRect();
  if (containerRect.width <= 0 || containerRect.height <= 0) return [];

  const pageRects: AiDocumentViewportPageRect[] = [];
  for (const pageElement of scrollContainer.querySelectorAll<HTMLElement>(
    '[id^="page-"]',
  )) {
    const pageNumber = parseWorkspacePageNumber(pageElement.id);
    if (!pageNumber || pageNumber > snapshot.pages.length) continue;

    const page = snapshot.pages[pageNumber - 1];
    if (!page) continue;

    const pageRect = pageElement.getBoundingClientRect();
    if (
      pageRect.width <= 0 ||
      pageRect.height <= 0 ||
      pageRect.right <= containerRect.left ||
      pageRect.left >= containerRect.right ||
      pageRect.bottom <= containerRect.top ||
      pageRect.top >= containerRect.bottom
    ) {
      continue;
    }

    const leftCss = Math.max(containerRect.left - pageRect.left, 0);
    const topCss = Math.max(containerRect.top - pageRect.top, 0);
    const rightCss = Math.min(
      containerRect.right - pageRect.left,
      pageRect.width,
    );
    const bottomCss = Math.min(
      containerRect.bottom - pageRect.top,
      pageRect.height,
    );

    const scaleX = pageRect.width / Math.max(page.width, 1);
    const scaleY = pageRect.height / Math.max(page.height, 1);
    if (scaleX <= 0 || scaleY <= 0) continue;

    const rect = clampPageSpaceRectToBounds(page.width, page.height, {
      x: leftCss / scaleX,
      y: topCss / scaleY,
      width: (rightCss - leftCss) / scaleX,
      height: (bottomCss - topCss) / scaleY,
    });
    if (!rect) continue;

    pageRects.push({
      pageNumber,
      pageWidth: page.width,
      pageHeight: page.height,
      rect,
    });
  }

  return pageRects.sort((left, right) => left.pageNumber - right.pageNumber);
};

export const createDocumentContextService = (options: {
  getWorkspaceRoot?: () => HTMLElement | null;
  getSnapshot: () => AiDocumentSnapshot;
  getSelectedTextContext: () => AiTextSelectionContext | null;
  getPdfSource?: () => {
    pdfBytes?: Uint8Array | null;
    password?: string | null;
  };
  getRenderablePdfBytes?: (options: {
    pageNumbers: number[];
    signal?: AbortSignal;
  }) => Promise<Uint8Array>;
  getPagesTextConfig?: () => {
    maxChars?: number;
  };
  canAttachPageVisuals?: () => boolean;
  analyzeRenderedPages?: (options: {
    pages: AiRenderedPageImage[];
    request?: string;
    signal?: AbortSignal;
  }) => Promise<string>;
  workerService?: PDFWorkerService;
}) => {
  const {
    getSnapshot,
    getSelectedTextContext,
    getPdfSource,
    getRenderablePdfBytes,
    getPagesTextConfig,
    canAttachPageVisuals,
    analyzeRenderedPages,
    workerService = pdfWorkerService,
  } = options;

  const pageTextCache = new Map<number, string>();
  const pageLinesCache = new Map<number, AiReadablePageLine[]>();

  const readPageText = async (pageIndex: number, signal?: AbortSignal) => {
    const cached = pageTextCache.get(pageIndex);
    if (typeof cached === "string") return cached;

    const textContent = await workerService.getTextContent({
      pageIndex,
      signal,
    });
    if (!textContent) return "";

    const snapshot = getSnapshot();
    const page = snapshot.pages[pageIndex];
    const text = serializePageTextContent(textContent, page).readableText;
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
      workerService,
      signal,
    });

    const normalized = lines.map((line) => ({
      text: line.sourceText,
      rect: roundAiRect(line.rect),
    }));
    pageLinesCache.set(pageIndex, normalized);
    return normalized;
  };

  const sliceLinesToTextRange = (
    lines: AiReadablePageLine[],
    start: number,
    end: number,
  ) => {
    let offset = 0;
    return lines.flatMap((line) => {
      const lineStart = offset;
      offset += line.text.length + 1; // Same newline separator as layout text.
      const from = Math.max(0, start - lineStart);
      const to = Math.min(line.text.length, end - lineStart);
      return from < to ? [{ ...line, text: line.text.slice(from, to) }] : [];
    });
  };

  const renderPageImageBatch = async ({
    pageNumbers,
    renderAnnotations = true,
    signal,
  }: {
    pageNumbers: PageVisualRequest[];
    renderAnnotations?: boolean;
    signal?: AbortSignal;
  }): Promise<AiRenderedPageImageBatch> => {
    throwIfAborted(signal);
    const snapshot = getSnapshot();
    const requested = resolvePageVisualRequests(pageNumbers, snapshot);
    const selected = requested.slice(0, AI_CHAT_MAX_PAGE_IMAGES_PER_CALL);
    const pages: AiRenderedPageImage[] = [];
    const batch = () => ({
      requestedPageCount: requested.length,
      returnedPageCount: pages.length,
      truncated: requested.length > pages.length,
      maxPagesPerCall: AI_CHAT_MAX_PAGE_IMAGES_PER_CALL,
      pages,
    });
    if (!selected.length) return batch();

    // Export uses ascending source indices. Preserve that mapping even when
    // the model requests pages in another order or several crops on one page.
    const uniquePageNumbers = [
      ...new Set(selected.map((item) => item.pageNumber)),
    ].sort((a, b) => a - b);
    let docId: string | undefined;
    try {
      if (getRenderablePdfBytes) {
        const bytes = await getRenderablePdfBytes({
          pageNumbers: uniquePageNumbers,
          signal,
        });
        throwIfAborted(signal);
        if (!bytes?.byteLength)
          throw new Error("Failed to export a renderable PDF snapshot.");
        docId = `ai_render_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await workerService.loadDocument(bytes, { docId, signal });
      }

      for (const request of selected) {
        throwIfAborted(signal);
        const sourcePage = snapshot.pages[request.pageNumber - 1]!;
        const viewport = buildPageViewport(sourcePage);
        const width = request.cropRect?.width ?? viewport.width;
        const height = request.cropRect?.height ?? viewport.height;
        let plan = getPageImageRenderPlan(width, height);
        let image: AiRenderedPageImage | undefined;
        // Keep linework lossless when possible. If PNG is too large, retry as
        // JPEG, then reduce the raster further. Never return oversized bytes.
        for (let attempt = 0; attempt < 4; attempt += 1) {
          throwIfAborted(signal);
          if (attempt >= 2)
            plan = getPageImageRenderPlan(
              width,
              height,
              plan.pixelDensity * 0.7,
            );
          const renderOptions = {
            docId,
            pageIndex: docId
              ? uniquePageNumbers.indexOf(request.pageNumber)
              : request.pageNumber - 1,
            scale: plan.pixelDensity,
            rotation: sourcePage.rotation,
            clipRect: request.cropRect,
            renderAnnotations,
            mimeType: attempt === 0 ? "image/png" : "image/jpeg",
            quality: 0.85,
            priority: 0,
            signal,
          };
          const rendered = await workerService
            .renderPageImage(renderOptions)
            .catch(async (error: unknown) => {
              if (
                docId ||
                !(error instanceof Error) ||
                !error.message.includes("PDF Document not loaded")
              )
                throw error;
              throwIfAborted(signal);
              const source = getPdfSource?.();
              if (!source?.pdfBytes?.byteLength) throw error;
              return workerService.renderPageImage({
                ...renderOptions,
                isNewDoc: true,
                data: source.pdfBytes,
                password: source.password ?? undefined,
              });
            });
          throwIfAborted(signal);
          if (!rendered.bytes?.byteLength)
            throw new Error(
              `Failed to render page image for page ${request.pageNumber}.`,
            );
          if (rendered.bytes.byteLength > AI_CHAT_PAGE_IMAGE_MAX_BYTES)
            continue;
          image = {
            pageNumber: request.pageNumber,
            pageWidth: viewport.width,
            pageHeight: viewport.height,
            rotation: sourcePage.rotation,
            ...(request.cropRect ? { cropRect: request.cropRect } : {}),
            ...plan,
            imageByteLength: rendered.bytes.byteLength,
            mimeType: rendered.mimeType || renderOptions.mimeType,
            renderAnnotations,
            base64Data: convertUint8ArrayToBase64(rendered.bytes),
          };
          break;
        }
        if (!image)
          throw new Error(
            `Page ${request.pageNumber} image exceeds the ${AI_CHAT_PAGE_IMAGE_MAX_BYTES} byte limit. Request a smaller page-space crop.`,
          );
        pages.push(image);
      }
      return batch();
    } finally {
      if (docId) workerService.unloadDocument(docId);
    }
  };

  return {
    getDocumentContext: () => {
      const snapshot = getSnapshot();
      const selected = getSelectedTextContext();
      const computedVisiblePageNumbers = getVisibleWorkspacePageNumbers(
        snapshot.pages.length,
        options.getWorkspaceRoot?.(),
      );
      const fallbackVisiblePageNumbers =
        snapshot.pages.length > 0 ? [snapshot.currentPageIndex + 1] : [];
      const visiblePageNumbers =
        computedVisiblePageNumbers.length > 0
          ? computedVisiblePageNumbers
          : fallbackVisiblePageNumbers;
      const viewportPageRects = getWorkspaceViewportPageRects(
        snapshot,
        options.getWorkspaceRoot?.(),
      );
      const currentViewportRect =
        viewportPageRects.find(
          (item) => item.pageNumber === snapshot.currentPageIndex + 1,
        ) ??
        viewportPageRects[0] ??
        null;

      return {
        pageCount: snapshot.pages.length,
        currentPageNumber:
          snapshot.pages.length > 0 ? snapshot.currentPageIndex + 1 : null,
        visiblePageNumbers,
        currentViewportRect,
        viewportPageRects,
        scale: Number(
          workspaceScaleToPdfViewerScale(snapshot.scale).toFixed(3),
        ),
        zoomPercent: workspaceScaleToZoomPercent(snapshot.scale),
        pageLayout: snapshot.pageLayout,
        pageFlow: snapshot.pageFlow,
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

    canAttachPageVisuals: () => canAttachPageVisuals?.() === true,

    getPagesVisual: async ({
      pageNumbers,
      renderAnnotations = true,
      signal,
    }: {
      pageNumbers: PageVisualRequest[];
      renderAnnotations?: boolean;
      signal?: AbortSignal;
    }): Promise<AiRenderedPageImageBatch> => {
      return await renderPageImageBatch({
        pageNumbers,
        renderAnnotations,
        signal,
      });
    },

    inspectPagesVisual: analyzeRenderedPages
      ? async ({
          pageNumbers,
          renderAnnotations = true,
          request,
          signal,
        }: {
          pageNumbers: PageVisualRequest[];
          renderAnnotations?: boolean;
          request?: string;
          signal?: AbortSignal;
        }): Promise<AiRenderedPageVisualSummaryResult> => {
          const pageImageBatch = await renderPageImageBatch({
            pageNumbers,
            renderAnnotations,
            signal,
          });

          const summary = await analyzeRenderedPages({
            pages: pageImageBatch.pages,
            request,
            signal,
          });

          return {
            requestedPageCount: pageImageBatch.requestedPageCount,
            returnedPageCount: pageImageBatch.returnedPageCount,
            truncated: pageImageBatch.truncated,
            maxPagesPerCall: AI_CHAT_MAX_PAGE_IMAGES_PER_CALL,
            request,
            pages: pageImageBatch.pages.map((page) => ({
              pageNumber: page.pageNumber,
              pageWidth: page.pageWidth,
              pageHeight: page.pageHeight,
              rotation: page.rotation,
              cropRect: page.cropRect,
              pixelDensity: page.pixelDensity,
              downscaled: page.downscaled,
              imageByteLength: page.imageByteLength,
              renderedWidth: page.renderedWidth,
              renderedHeight: page.renderedHeight,
              renderAnnotations: page.renderAnnotations,
            })),
            summary,
          };
        }
      : undefined,

    getPagesText: async ({
      pageNumbers,
      includeLayout = false,
      cursor,
      signal,
    }: {
      pageNumbers: number[];
      includeLayout?: boolean;
      cursor?: AiPageTextCursor;
      signal?: AbortSignal;
    }): Promise<AiReadablePageBatch> => {
      const snapshot = getSnapshot();
      const requestedPageNumbers = clampPageNumbers(
        pageNumbers,
        snapshot.pages.length,
        snapshot.pages.length,
      );
      const startIndex = cursor
        ? requestedPageNumbers.indexOf(cursor.page_number)
        : 0;
      if (
        startIndex < 0 ||
        (cursor &&
          (!Number.isSafeInteger(cursor.char_offset) || cursor.char_offset < 0))
      ) {
        throw new Error(
          "Invalid text cursor. Keep the original page_numbers or restart without a cursor.",
        );
      }
      const maxChars = clampGetPagesTextMaxChars(
        getPagesTextConfig?.()?.maxChars,
      );
      const pages: AiReadablePage[] = [];
      let returnedCharCount = 0;
      let nextCursor: AiPageTextCursor | null = null;

      for (
        let index = startIndex;
        index < requestedPageNumbers.length;
        index += 1
      ) {
        throwIfAborted(signal);
        const pageNumber = requestedPageNumbers[index]!;
        const startOffset =
          index === startIndex ? (cursor?.char_offset ?? 0) : 0;
        const remainingChars = maxChars - returnedCharCount;
        if (remainingChars <= 0) {
          nextCursor = { page_number: pageNumber, char_offset: startOffset };
          break;
        }
        const pageIndex = pageNumber - 1;
        const lines = includeLayout
          ? await readPageLines(pageIndex, signal)
          : undefined;
        // A layout read uses the same ordered lines for text and rectangles,
        // so continuation offsets cannot drift across synthetic whitespace.
        const fullText = lines?.length
          ? lines.map((line) => line.text).join("\n")
          : await readPageText(pageIndex, signal);
        throwIfAborted(signal);
        if (startOffset > fullText.length) {
          throw new Error(
            "Text cursor exceeds the page length. Restart without a cursor after document edits.",
          );
        }
        let endOffset = Math.min(fullText.length, startOffset + remainingChars);
        // Never split a UTF-16 surrogate pair between responses.
        if (
          endOffset < fullText.length &&
          /[\uD800-\uDBFF]/u.test(fullText[endOffset - 1] ?? "") &&
          /[\uDC00-\uDFFF]/u.test(fullText[endOffset] ?? "")
        ) {
          endOffset -= 1;
        }
        const text = fullText.slice(startOffset, endOffset);
        const pageTruncated = endOffset < fullText.length;
        const page: AiReadablePage = {
          pageNumber,
          text,
          charCount: text.length,
          startOffset,
          totalCharCount: fullText.length,
          ...(pageTruncated ? { truncated: true } : {}),
        };
        if (lines) {
          page.lines = sliceLinesToTextRange(lines, startOffset, endOffset);
          page.lineCount = page.lines.length;
        }
        pages.push(page);
        returnedCharCount += text.length;
        if (pageTruncated) {
          nextCursor = { page_number: pageNumber, char_offset: endOffset };
          break;
        }
      }
      return {
        requestedPageCount: requestedPageNumbers.length,
        returnedPageCount: pages.length,
        returnedCharCount,
        truncated: nextCursor !== null,
        maxCharsPerCall: maxChars,
        nextCursor,
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
      offset = 0,
      signal,
    }: {
      query: string;
      pageNumbers?: number[];
      caseSensitive?: boolean;
      mode?: PDFSearchMode;
      regexFlags?: string;
      maxResults?: number;
      offset?: number;
      signal?: AbortSignal;
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

          const textContent = await workerService.getTextContent({
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

      throwIfAborted(signal);
      return paginateAiResults(
        allMatches.flat(),
        { maxResults, offset },
        { default: 20, max: 50 },
      );
    },
  };
};

export type AiDocumentToolContext = ReturnType<
  typeof createDocumentContextService
>;
