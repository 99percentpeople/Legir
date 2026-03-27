import {
  AI_CHAT_DIGEST_MAX_PAGES_PER_LEAF_CHUNK,
  AI_CHAT_DIGEST_MERGE_BATCH_SIZE,
  AI_CHAT_DIGEST_OUTPUT_CHARS_MAX,
  AI_CHAT_DIGEST_OUTPUT_CHARS_MIN,
  AI_CHAT_PAGE_IMAGE_PIXEL_DENSITY,
  AI_CHAT_DIGEST_SUMMARY_CONCURRENCY,
  AI_CHAT_DIGEST_SOURCE_CHARS_MAX,
  AI_CHAT_DIGEST_SOURCE_CHARS_MIN,
  AI_CHAT_MAX_PAGE_IMAGES_PER_CALL,
  AI_CHAT_MAX_READ_PAGES_PER_CALL,
} from "@/constants";
import { convertUint8ArrayToBase64 } from "@ai-sdk/provider-utils";
import { findPdfSearchResults, type PDFSearchMode } from "@/lib/pdfSearch";
import { pageTranslationService } from "@/services/pageTranslationService";
import { createViewportFromPageInfo } from "@/services/pdfService/lib/coords";
import { pdfWorkerService } from "@/services/pdfService/pdfWorkerService";
import { roundAiRect } from "@/services/ai/utils/geometry";
import { serializePageTextContent } from "@/services/ai/utils/pageTextSerialization";
import type {
  AiDocumentDigestChunk,
  AiDocumentDigestSourceKind,
  AiDocumentMetadata,
  AiDocumentViewportPageRect,
  AiPageSpaceRect,
  AiRenderedPageImage,
  AiRenderedPageImageBatch,
  AiRenderedPageVisualSummaryResult,
  AiSummaryInstructions,
  AiDocumentSnapshot,
  AiReadablePage,
  AiReadablePageLine,
  AiTextSelectionContext,
  AiToolExecutionProgressItem,
} from "./types";

const clampNumber = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const normalizeExcerptText = (text: string) => text.replace(/\s+/g, " ").trim();
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

const buildDigestSummaryMergeInput = (
  chunks: AiDocumentDigestChunk[],
  totalBudget: number,
) => {
  if (chunks.length === 0) return "";

  const availableBudget = Math.max(
    96,
    totalBudget - chunks.length * DIGEST_LABEL_OVERHEAD_PER_PAGE,
  );
  const perChunkBudget = clampNumber(
    Math.floor(availableBudget / Math.max(1, chunks.length)),
    64,
    Math.max(64, availableBudget),
  );

  return chunks
    .map((chunk) => {
      const label =
        chunk.startPage === chunk.endPage
          ? `p${chunk.startPage}`
          : `p${chunk.startPage}-${chunk.endPage}`;
      return `${label}: ${sampleTextBalanced(chunk.excerpt, perChunkBudget)}`;
    })
    .join("\n");
};

const createDigestLeafChunks = (
  pages: Array<{ pageNumber: number; text: string; charCount: number }>,
  maxCharsPerChunk: number,
) => {
  const chunks: Array<typeof pages> = [];
  let current: Array<(typeof pages)[number]> = [];
  let currentChars = 0;

  for (const page of pages) {
    const exceedsPageCount =
      current.length >= AI_CHAT_DIGEST_MAX_PAGES_PER_LEAF_CHUNK;
    const exceedsCharBudget =
      current.length > 0 && currentChars + page.charCount > maxCharsPerChunk;

    if (exceedsPageCount || exceedsCharBudget) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(page);
    currentChars += page.charCount;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
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

const isAbortError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  (error as { name?: string }).name === "AbortError";

const formatErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return truncateText(error.message, 120);
  }
  if (typeof error === "string" && error.trim()) {
    return truncateText(error, 120);
  }
  return "unknown error";
};

const DIGEST_PROGRESS_DETAIL_LIMIT = 12;
const DIGEST_PROGRESS_LOG_LIMIT = 120;
type DigestProgressEntryStatus = "pending" | "running" | "done";
type DigestProgressEntry = AiToolExecutionProgressItem;

const formatDigestRangeLabel = (startPage: number, endPage: number) =>
  startPage === endPage ? `p${startPage}` : `p${startPage}-${endPage}`;

const buildDigestProgressItems = (entries: DigestProgressEntry[]) =>
  entries
    .filter((entry) => entry.status === "running")
    .sort(
      (left, right) =>
        (left.level ?? 0) - (right.level ?? 0) ||
        left.label.localeCompare(right.label),
    )
    .slice(0, DIGEST_PROGRESS_DETAIL_LIMIT);

const buildDigestProgressCounts = (entries: DigestProgressEntry[]) =>
  entries.reduce(
    (counts, entry) => {
      counts[entry.status] += 1;
      return counts;
    },
    { pending: 0, running: 0, done: 0 },
  );

const buildLayerStatusSummary = (entries: DigestProgressEntry[]) => {
  const countsByLevel = entries.reduce((map, entry) => {
    if (typeof entry.level !== "number") return map;
    const current = map.get(entry.level) ?? { running: 0, pending: 0, done: 0 };
    current[entry.status] += 1;
    map.set(entry.level, current);
    return map;
  }, new Map<number, { running: number; pending: number; done: number }>());

  if (countsByLevel.size === 0) return "";

  return Array.from(countsByLevel.entries())
    .sort(([leftLevel], [rightLevel]) => leftLevel - rightLevel)
    .map(
      ([level, counts]) =>
        `L${level}:${counts.running}/${counts.pending}/${counts.done}`,
    )
    .join(" ");
};

const formatDigestProgressLog = (
  task: Pick<DigestProgressEntry, "label" | "level">,
  status: string,
) =>
  `${typeof task.level === "number" ? `L${task.level}` : "--"} · ${task.label} · ${status}`;

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

const parseWorkspacePageNumber = (value: string) => {
  const pageIndex = Number.parseInt(value.replace(/^page-/, ""), 10);
  if (!Number.isFinite(pageIndex) || pageIndex < 0) return null;
  return pageIndex + 1;
};

const getVisibleWorkspacePageNumbers = (totalPages: number) => {
  if (typeof document === "undefined" || totalPages <= 0) return [];

  const scrollContainer = document.querySelector(
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
type RenderedPageImageSource = Omit<AiRenderedPageImage, "base64Data"> & {
  imageBytes: Uint8Array;
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

const getRenderedImageDimensions = (options: {
  pageWidth: number;
  pageHeight: number;
  pixelDensity: number;
}) => {
  return {
    renderedWidth: Math.max(
      1,
      Math.round(options.pageWidth * options.pixelDensity),
    ),
    renderedHeight: Math.max(
      1,
      Math.round(options.pageHeight * options.pixelDensity),
    ),
  };
};

const clampPageSpaceRectToBounds = (
  pageWidth: number,
  pageHeight: number,
  rect: AiPageSpaceRect,
): AiPageSpaceRect | null => {
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

    const cropRect =
      typeof rawRequest === "number"
        ? undefined
        : clampPageSpaceRectToBounds(page.width, page.height, rawRequest.rect);
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
): AiDocumentViewportPageRect[] => {
  if (typeof document === "undefined" || snapshot.pages.length === 0) {
    return [];
  }

  const scrollContainer = document.querySelector(
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
  getDigestConfig?: () => {
    charsPerChunk?: number;
    sourceCharsPerChunk?: number;
  };
  summarizeDigestChunk?: (options: {
    startPage: number;
    endPage: number;
    sampledText: string;
    maxChars: number;
    sourceKind?: AiDocumentDigestSourceKind;
    summaryInstructions?: AiSummaryInstructions;
    signal?: AbortSignal;
  }) => Promise<string>;
  summarizeRenderedPages?: (options: {
    pages: AiRenderedPageImage[];
    summaryInstructions?: AiSummaryInstructions;
    signal?: AbortSignal;
  }) => Promise<string>;
}) => {
  const {
    getSnapshot,
    getSelectedTextContext,
    getPdfSource,
    getRenderablePdfBytes,
    getDigestConfig,
    summarizeDigestChunk,
    summarizeRenderedPages,
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
      signal,
    });

    const normalized = lines.map((line) => ({
      text: line.sourceText,
      rect: roundAiRect(line.rect),
    }));
    pageLinesCache.set(pageIndex, normalized);
    return normalized;
  };

  const renderPageImageSourceFromCurrentDocument = async ({
    pageNumber,
    renderAnnotations = true,
    signal,
  }: {
    pageNumber: number;
    renderAnnotations?: boolean;
    signal?: AbortSignal;
  }): Promise<RenderedPageImageSource> => {
    const snapshot = getSnapshot();
    const resolvedPageNumber = clampPageNumbers(
      [pageNumber],
      snapshot.pages.length,
      1,
    )[0];
    const pageIndex =
      typeof resolvedPageNumber === "number" ? resolvedPageNumber - 1 : -1;
    const page = snapshot.pages[pageIndex];

    if (!page || resolvedPageNumber < 1) {
      throw new Error(`Invalid page number: ${pageNumber}`);
    }

    const pixelDensity = AI_CHAT_PAGE_IMAGE_PIXEL_DENSITY;
    const pageViewport = createViewportFromPageInfo(
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
    const { renderedWidth, renderedHeight } = getRenderedImageDimensions({
      pageWidth: pageViewport.width,
      pageHeight: pageViewport.height,
      pixelDensity,
    });

    const renderCurrentDocumentPage = () =>
      pdfWorkerService.renderPageImage({
        pageIndex,
        scale: pixelDensity,
        renderAnnotations,
        mimeType: "image/png",
        priority: 0,
        signal,
      });

    let imageBytes: Uint8Array;
    let mimeType: string;

    try {
      ({ bytes: imageBytes, mimeType } = await renderCurrentDocumentPage());
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "");
      if (!message.includes("PDF Document not loaded")) {
        throw error;
      }

      const pdfSource = getPdfSource?.();
      const pdfBytes = pdfSource?.pdfBytes;
      if (!pdfBytes || pdfBytes.byteLength === 0) {
        throw error;
      }

      ({ bytes: imageBytes, mimeType } = await pdfWorkerService.renderPageImage(
        {
          pageIndex,
          scale: pixelDensity,
          renderAnnotations,
          mimeType: "image/png",
          priority: 0,
          signal,
          isNewDoc: true,
          data: pdfBytes,
          password:
            typeof pdfSource?.password === "string"
              ? pdfSource.password
              : undefined,
        },
      ));
    }

    if (!imageBytes || imageBytes.byteLength === 0) {
      throw new Error(`Failed to render page image for page ${pageNumber}.`);
    }

    return {
      pageNumber: resolvedPageNumber,
      pageWidth: Math.round(pageViewport.width),
      pageHeight: Math.round(pageViewport.height),
      rotation: page.rotation,
      pixelDensity,
      renderedWidth,
      renderedHeight,
      mimeType: mimeType || "image/png",
      renderAnnotations,
      imageBytes,
    };
  };

  const loadCanvasImageSource = async (
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<CanvasImageSource> => {
    const blob = new Blob([bytes.slice()], { type: mimeType || "image/png" });

    if (typeof createImageBitmap === "function") {
      return await createImageBitmap(blob);
    }

    if (typeof Image === "undefined" || typeof URL === "undefined") {
      throw new Error("Image cropping is unavailable in this environment.");
    }

    const objectUrl = URL.createObjectURL(blob);
    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () =>
          reject(new Error("Failed to decode rendered page image."));
        image.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const releaseCanvasImageSource = (source: CanvasImageSource) => {
    if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
      source.close();
    }
  };

  const getCanvasImageSourceDimensions = (source: CanvasImageSource) => {
    if (
      typeof source === "object" &&
      source !== null &&
      "naturalWidth" in source &&
      "naturalHeight" in source &&
      typeof source.naturalWidth === "number" &&
      typeof source.naturalHeight === "number"
    ) {
      return {
        width: source.naturalWidth,
        height: source.naturalHeight,
      };
    }

    if (
      typeof source === "object" &&
      source !== null &&
      "width" in source &&
      "height" in source &&
      typeof source.width === "number" &&
      typeof source.height === "number"
    ) {
      return {
        width: source.width,
        height: source.height,
      };
    }

    return null;
  };

  const createRasterSurface = (width: number, height: number) => {
    if (typeof OffscreenCanvas === "function") {
      const canvas = new OffscreenCanvas(width, height);
      return { canvas, context: canvas.getContext("2d") };
    }

    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return { canvas, context: canvas.getContext("2d") };
    }

    throw new Error("Canvas rendering is unavailable in this environment.");
  };

  const canvasToPngBytes = async (
    canvas: OffscreenCanvas | HTMLCanvasElement,
  ) => {
    const blob =
      typeof OffscreenCanvas === "function" && canvas instanceof OffscreenCanvas
        ? await canvas.convertToBlob({ type: "image/png" })
        : await new Promise<Blob>((resolve, reject) => {
            (canvas as HTMLCanvasElement).toBlob((value) => {
              if (value) {
                resolve(value);
                return;
              }
              reject(new Error("Failed to encode cropped page image."));
            }, "image/png");
          });

    return new Uint8Array(await blob.arrayBuffer());
  };

  const materializeRenderedPageImage = async (
    source: RenderedPageImageSource,
    cropRect?: AiPageSpaceRect,
  ): Promise<AiRenderedPageImage> => {
    if (!cropRect) {
      return {
        pageNumber: source.pageNumber,
        pageWidth: source.pageWidth,
        pageHeight: source.pageHeight,
        rotation: source.rotation,
        pixelDensity: source.pixelDensity,
        renderedWidth: source.renderedWidth,
        renderedHeight: source.renderedHeight,
        mimeType: source.mimeType,
        renderAnnotations: source.renderAnnotations,
        base64Data: convertUint8ArrayToBase64(source.imageBytes),
      };
    }

    const clampedCropRect = clampPageSpaceRectToBounds(
      source.pageWidth,
      source.pageHeight,
      cropRect,
    );
    if (!clampedCropRect) {
      throw new Error(
        `Invalid crop rect for page ${source.pageNumber}: no visible area remained after clamping.`,
      );
    }

    const imageSource = await loadCanvasImageSource(
      source.imageBytes,
      source.mimeType,
    );

    const decodedSize = getCanvasImageSourceDimensions(imageSource);
    const sourceImageWidth = Math.max(
      1,
      decodedSize?.width ?? source.renderedWidth,
    );
    const sourceImageHeight = Math.max(
      1,
      decodedSize?.height ?? source.renderedHeight,
    );
    const sourceX = Math.max(
      0,
      Math.min(
        sourceImageWidth - 1,
        Math.floor((clampedCropRect.x / source.pageWidth) * sourceImageWidth),
      ),
    );
    const sourceY = Math.max(
      0,
      Math.min(
        sourceImageHeight - 1,
        Math.floor((clampedCropRect.y / source.pageHeight) * sourceImageHeight),
      ),
    );
    const sourceRight = Math.max(
      sourceX + 1,
      Math.min(
        sourceImageWidth,
        Math.ceil(
          ((clampedCropRect.x + clampedCropRect.width) / source.pageWidth) *
            sourceImageWidth,
        ),
      ),
    );
    const sourceBottom = Math.max(
      sourceY + 1,
      Math.min(
        sourceImageHeight,
        Math.ceil(
          ((clampedCropRect.y + clampedCropRect.height) / source.pageHeight) *
            sourceImageHeight,
        ),
      ),
    );
    const croppedWidth = Math.max(1, sourceRight - sourceX);
    const croppedHeight = Math.max(1, sourceBottom - sourceY);

    try {
      const { canvas, context } = createRasterSurface(
        croppedWidth,
        croppedHeight,
      );
      if (!context) {
        throw new Error("Failed to initialize canvas for page crop.");
      }

      context.drawImage(
        imageSource,
        sourceX,
        sourceY,
        croppedWidth,
        croppedHeight,
        0,
        0,
        croppedWidth,
        croppedHeight,
      );

      const croppedBytes = await canvasToPngBytes(canvas);
      return {
        pageNumber: source.pageNumber,
        pageWidth: source.pageWidth,
        pageHeight: source.pageHeight,
        rotation: source.rotation,
        cropRect: clampedCropRect,
        pixelDensity: source.pixelDensity,
        renderedWidth: croppedWidth,
        renderedHeight: croppedHeight,
        mimeType: "image/png",
        renderAnnotations: source.renderAnnotations,
        base64Data: convertUint8ArrayToBase64(croppedBytes),
      };
    } finally {
      releaseCanvasImageSource(imageSource);
    }
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
    const snapshot = getSnapshot();
    const requestedPageRequests = resolvePageVisualRequests(
      pageNumbers,
      snapshot,
    );
    const resolvedPageRequests = resolvePageVisualRequests(
      pageNumbers,
      snapshot,
      AI_CHAT_MAX_PAGE_IMAGES_PER_CALL,
    );

    if (resolvedPageRequests.length === 0) {
      return {
        requestedPageCount: requestedPageRequests.length,
        returnedPageCount: 0,
        truncated: requestedPageRequests.length > 0,
        maxPagesPerCall: AI_CHAT_MAX_PAGE_IMAGES_PER_CALL,
        pages: [],
      };
    }

    const pixelDensity = AI_CHAT_PAGE_IMAGE_PIXEL_DENSITY;
    const pages: AiRenderedPageImage[] = [];

    if (!getRenderablePdfBytes) {
      const pageSources = new Map<number, RenderedPageImageSource>();
      for (const request of resolvedPageRequests) {
        let source = pageSources.get(request.pageNumber);
        if (!source) {
          source = await renderPageImageSourceFromCurrentDocument({
            pageNumber: request.pageNumber,
            renderAnnotations,
            signal,
          });
          pageSources.set(request.pageNumber, source);
        }

        pages.push(
          await materializeRenderedPageImage(source, request.cropRect),
        );
      }

      return {
        requestedPageCount: requestedPageRequests.length,
        returnedPageCount: pages.length,
        truncated: requestedPageRequests.length > pages.length,
        maxPagesPerCall: AI_CHAT_MAX_PAGE_IMAGES_PER_CALL,
        pages,
      };
    }

    const uniquePageNumbers = Array.from(
      new Set(resolvedPageRequests.map((request) => request.pageNumber)),
    );
    const renderablePdfBytes = await getRenderablePdfBytes({
      pageNumbers: uniquePageNumbers,
      signal,
    });
    if (!renderablePdfBytes || renderablePdfBytes.byteLength === 0) {
      throw new Error("Failed to export a renderable PDF snapshot.");
    }

    const docId = `ai_render_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      await pdfWorkerService.loadDocument(renderablePdfBytes, {
        docId,
        signal,
      });

      const pageSources = new Map<number, RenderedPageImageSource>();
      for (
        let subsetPageIndex = 0;
        subsetPageIndex < uniquePageNumbers.length;
        subsetPageIndex += 1
      ) {
        throwIfAborted(signal);

        const pageNumber = uniquePageNumbers[subsetPageIndex]!;
        const sourcePage = snapshot.pages[pageNumber - 1];
        if (!sourcePage) {
          throw new Error(`Invalid page number: ${pageNumber}`);
        }

        const pageViewport = buildPageViewport(sourcePage);
        const { renderedWidth, renderedHeight } = getRenderedImageDimensions({
          pageWidth: pageViewport.width,
          pageHeight: pageViewport.height,
          pixelDensity,
        });

        const { bytes: imageBytes, mimeType } =
          await pdfWorkerService.renderPageImage({
            docId,
            pageIndex: subsetPageIndex,
            scale: pixelDensity,
            renderAnnotations,
            mimeType: "image/png",
            priority: 0,
            signal,
          });

        if (!imageBytes || imageBytes.byteLength === 0) {
          throw new Error(
            `Failed to render exported page image for page ${pageNumber}.`,
          );
        }

        pageSources.set(pageNumber, {
          pageNumber,
          pageWidth: Math.round(pageViewport.width),
          pageHeight: Math.round(pageViewport.height),
          rotation: sourcePage.rotation,
          pixelDensity,
          renderedWidth,
          renderedHeight,
          mimeType: mimeType || "image/png",
          renderAnnotations,
          imageBytes,
        });
      }

      for (const request of resolvedPageRequests) {
        const source = pageSources.get(request.pageNumber);
        if (!source) {
          throw new Error(
            `Rendered page source missing for page ${request.pageNumber}.`,
          );
        }
        pages.push(
          await materializeRenderedPageImage(source, request.cropRect),
        );
      }
    } finally {
      pdfWorkerService.unloadDocument(docId);
    }

    return {
      requestedPageCount: requestedPageRequests.length,
      returnedPageCount: pages.length,
      truncated: requestedPageRequests.length > pages.length,
      maxPagesPerCall: AI_CHAT_MAX_PAGE_IMAGES_PER_CALL,
      pages,
    };
  };

  return {
    getDocumentContext: () => {
      const snapshot = getSnapshot();
      const selected = getSelectedTextContext();
      const computedVisiblePageNumbers = getVisibleWorkspacePageNumbers(
        snapshot.pages.length,
      );
      const fallbackVisiblePageNumbers =
        snapshot.pages.length > 0 ? [snapshot.currentPageIndex + 1] : [];
      const visiblePageNumbers =
        computedVisiblePageNumbers.length > 0
          ? computedVisiblePageNumbers
          : fallbackVisiblePageNumbers;
      const viewportPageRects = getWorkspaceViewportPageRects(snapshot);
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
        scale: Number(snapshot.scale.toFixed(3)),
        zoomPercent: Math.round(snapshot.scale * 100),
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

    summarizePagesVisual: summarizeRenderedPages
      ? async ({
          pageNumbers,
          renderAnnotations = true,
          summaryInstructions,
          signal,
        }: {
          pageNumbers: PageVisualRequest[];
          renderAnnotations?: boolean;
          summaryInstructions?: AiSummaryInstructions;
          signal?: AbortSignal;
        }): Promise<AiRenderedPageVisualSummaryResult> => {
          const pageImageBatch = await renderPageImageBatch({
            pageNumbers,
            renderAnnotations,
            signal,
          });

          const summary = await summarizeRenderedPages({
            pages: pageImageBatch.pages,
            summaryInstructions,
            signal,
          });

          return {
            requestedPageCount: pageImageBatch.requestedPageCount,
            returnedPageCount: pageImageBatch.returnedPageCount,
            truncated: pageImageBatch.truncated,
            maxPagesPerCall: AI_CHAT_MAX_PAGE_IMAGES_PER_CALL,
            pages: pageImageBatch.pages.map((page) => ({
              pageNumber: page.pageNumber,
              pageWidth: page.pageWidth,
              pageHeight: page.pageHeight,
              rotation: page.rotation,
              cropRect: page.cropRect,
              pixelDensity: page.pixelDensity,
              renderedWidth: page.renderedWidth,
              renderedHeight: page.renderedHeight,
              renderAnnotations: page.renderAnnotations,
            })),
            summary,
          };
        }
      : undefined,

    getDocumentDigest: summarizeDigestChunk
      ? async ({
          startPage,
          endPage,
          charsPerChunk,
          sourceCharsPerChunk,
          summaryInstructions,
          signal,
          onProgress,
        }) => {
          const snapshot = getSnapshot();
          const digestConfig = getDigestConfig?.();
          const resolvedPageNumbers = buildPageRange(
            startPage,
            endPage,
            snapshot.pages.length,
          );

          const requestedSourceCharsPerChunk = clampNumber(
            Math.trunc(
              sourceCharsPerChunk ??
                digestConfig?.sourceCharsPerChunk ??
                AI_CHAT_DIGEST_SOURCE_CHARS_MIN,
            ) || AI_CHAT_DIGEST_SOURCE_CHARS_MIN,
            AI_CHAT_DIGEST_SOURCE_CHARS_MIN,
            AI_CHAT_DIGEST_SOURCE_CHARS_MAX,
          );
          const requestedCharsPerChunk = clampNumber(
            Math.trunc(
              charsPerChunk ??
                digestConfig?.charsPerChunk ??
                Math.floor(requestedSourceCharsPerChunk / 3),
            ) || Math.floor(requestedSourceCharsPerChunk / 3),
            AI_CHAT_DIGEST_OUTPUT_CHARS_MIN,
            AI_CHAT_DIGEST_OUTPUT_CHARS_MAX,
          );
          const excerptCharsPerChunk = clampNumber(
            requestedCharsPerChunk,
            AI_CHAT_DIGEST_OUTPUT_CHARS_MIN,
            Math.max(
              AI_CHAT_DIGEST_OUTPUT_CHARS_MIN,
              Math.floor(requestedSourceCharsPerChunk / 2),
            ),
          );
          const effectiveSourceCharsPerChunk = clampNumber(
            Math.min(
              requestedSourceCharsPerChunk,
              Math.max(240, excerptCharsPerChunk * 12),
            ),
            excerptCharsPerChunk,
            AI_CHAT_DIGEST_SOURCE_CHARS_MAX,
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
          throwIfAborted(signal);

          const leafPageChunks = createDigestLeafChunks(
            pages,
            effectiveSourceCharsPerChunk,
          );
          type DigestTaskNode = {
            id: string;
            label: string;
            level: number;
            kind: "leaf" | "merge";
            status: DigestProgressEntryStatus;
            startPage: number;
            endPage: number;
            pageChunk?: typeof pages;
            childIds?: string[];
            parentId?: string;
            result?: AiDocumentDigestChunk;
          };

          const taskNodes = new Map<string, DigestTaskNode>();
          const progressEntries: DigestProgressEntry[] = [];
          const progressEntryIndexByTaskId = new Map<string, number>();
          const leafTaskIds: string[] = [];

          const registerTaskNode = (node: DigestTaskNode) => {
            taskNodes.set(node.id, node);
            progressEntryIndexByTaskId.set(node.id, progressEntries.length);
            progressEntries.push({
              id: node.id,
              label: node.label,
              status: node.status,
              level: node.level,
            });
          };

          leafPageChunks.forEach((pageChunk, pageChunkIndex) => {
            const startPageNumber = pageChunk[0]!.pageNumber;
            const endPageNumber = pageChunk[pageChunk.length - 1]!.pageNumber;
            const id = `leaf:${pageChunkIndex}:${startPageNumber}-${endPageNumber}`;
            leafTaskIds.push(id);
            registerTaskNode({
              id,
              label: formatDigestRangeLabel(startPageNumber, endPageNumber),
              level: 1,
              kind: "leaf",
              status: "pending",
              startPage: startPageNumber,
              endPage: endPageNumber,
              pageChunk,
            });
          });

          let currentTaskIds = [...leafTaskIds];
          let taskLevel = 2;
          while (currentTaskIds.length > 1) {
            const nextTaskIds: string[] = [];
            for (
              let index = 0;
              index < currentTaskIds.length;
              index += AI_CHAT_DIGEST_MERGE_BATCH_SIZE
            ) {
              const childIds = currentTaskIds.slice(
                index,
                index + AI_CHAT_DIGEST_MERGE_BATCH_SIZE,
              );
              const firstChild = taskNodes.get(childIds[0]!);
              const lastChild = taskNodes.get(childIds[childIds.length - 1]!);
              if (!firstChild || !lastChild) continue;
              const id = `merge:${taskLevel}:${index / AI_CHAT_DIGEST_MERGE_BATCH_SIZE}:${firstChild.startPage}-${lastChild.endPage}`;
              nextTaskIds.push(id);
              registerTaskNode({
                id,
                label: formatDigestRangeLabel(
                  firstChild.startPage,
                  lastChild.endPage,
                ),
                level: taskLevel,
                kind: "merge",
                status: "pending",
                startPage: firstChild.startPage,
                endPage: lastChild.endPage,
                childIds,
              });
              childIds.forEach((childId) => {
                const childNode = taskNodes.get(childId);
                if (childNode) childNode.parentId = id;
              });
            }
            currentTaskIds = nextTaskIds;
            taskLevel += 1;
          }

          const rootTaskId = currentTaskIds[0] ?? leafTaskIds[0];
          const progressLogs: string[] = [];

          const emitDigestProgress = (summary: string, logEntry?: string) => {
            if (logEntry) {
              progressLogs.push(logEntry);
              if (progressLogs.length > DIGEST_PROGRESS_LOG_LIMIT) {
                progressLogs.splice(
                  0,
                  progressLogs.length - DIGEST_PROGRESS_LOG_LIMIT,
                );
              }
            }
            onProgress?.({
              summary,
              details: [...progressLogs],
              counts: buildDigestProgressCounts(progressEntries),
              items: buildDigestProgressItems(progressEntries),
            });
          };

          const updateTaskStatus = (
            taskId: string,
            status: DigestProgressEntryStatus,
          ) => {
            const progressIndex = progressEntryIndexByTaskId.get(taskId);
            if (typeof progressIndex !== "number") return;
            progressEntries[progressIndex] = {
              ...progressEntries[progressIndex]!,
              status,
            };
            const taskNode = taskNodes.get(taskId);
            if (taskNode) taskNode.status = status;
          };

          const digestRangeLabel = formatDigestRangeLabel(
            resolvedPageNumbers[0]!,
            resolvedPageNumbers[resolvedPageNumbers.length - 1]!,
          );
          const buildDigestExecutionSummary = () =>
            `Running ${buildLayerStatusSummary(progressEntries)} running/pending/completed for ${digestRangeLabel}`;

          emitDigestProgress(buildDigestExecutionSummary());

          const readyQueue: string[] = [];
          const queuedTaskIds = new Set<string>();
          let runningTaskCount = 0;
          let finished = false;

          const enqueueReadyTask = (taskId: string) => {
            if (queuedTaskIds.has(taskId)) return;
            const taskNode = taskNodes.get(taskId);
            if (!taskNode) return;
            queuedTaskIds.add(taskId);
            const insertIndex = readyQueue.findIndex((queuedTaskId) => {
              const queuedTask = taskNodes.get(queuedTaskId);
              return (queuedTask?.level ?? 0) < taskNode.level;
            });
            if (insertIndex === -1) {
              readyQueue.push(taskId);
            } else {
              readyQueue.splice(insertIndex, 0, taskId);
            }
            emitDigestProgress(
              buildDigestExecutionSummary(),
              formatDigestProgressLog(taskNode, "waiting"),
            );
          };

          const enqueueTaskIfReady = (taskId: string) => {
            if (queuedTaskIds.has(taskId)) return;
            const taskNode = taskNodes.get(taskId);
            if (!taskNode || taskNode.status !== "pending") return;
            if (taskNode.kind === "merge") {
              const childNodes =
                taskNode.childIds?.map((childId) => taskNodes.get(childId)) ??
                [];
              if (
                childNodes.length === 0 ||
                childNodes.some((childNode) => !childNode?.result)
              ) {
                return;
              }
            }
            enqueueReadyTask(taskId);
          };

          leafTaskIds.forEach((taskId) => {
            enqueueReadyTask(taskId);
          });

          const executeTask = async (taskNode: DigestTaskNode) => {
            if (taskNode.kind === "leaf") {
              const pageChunk = taskNode.pageChunk ?? [];
              const fallbackExcerpt = truncateText(
                buildChunkSample(pageChunk, excerptCharsPerChunk),
                excerptCharsPerChunk,
              );
              let normalizedSummary = "";
              try {
                const summary = await summarizeDigestChunk({
                  startPage: taskNode.startPage,
                  endPage: taskNode.endPage,
                  sampledText: buildChunkSample(
                    pageChunk,
                    effectiveSourceCharsPerChunk,
                  ),
                  maxChars: excerptCharsPerChunk,
                  sourceKind: "page_text",
                  summaryInstructions,
                  signal,
                });
                normalizedSummary = normalizeExcerptText(summary);
              } catch (error) {
                if (isAbortError(error)) throw error;
                emitDigestProgress(
                  buildDigestExecutionSummary(),
                  formatDigestProgressLog(
                    taskNode,
                    `fallback (${formatErrorMessage(error)})`,
                  ),
                );
              }
              return {
                startPage: taskNode.startPage,
                endPage: taskNode.endPage,
                pageCount: pageChunk.length,
                charCount: pageChunk.reduce(
                  (sum, page) => sum + page.charCount,
                  0,
                ),
                excerpt: truncateText(
                  normalizedSummary || fallbackExcerpt,
                  excerptCharsPerChunk,
                ),
              } satisfies AiDocumentDigestChunk;
            }

            const childChunks =
              taskNode.childIds
                ?.map((childId) => taskNodes.get(childId)?.result)
                .filter(Boolean) ?? [];
            const fallbackExcerpt = truncateText(
              buildDigestSummaryMergeInput(childChunks, excerptCharsPerChunk),
              excerptCharsPerChunk,
            );
            let normalizedSummary = "";
            try {
              const summary = await summarizeDigestChunk({
                startPage: taskNode.startPage,
                endPage: taskNode.endPage,
                sampledText: buildDigestSummaryMergeInput(
                  childChunks,
                  effectiveSourceCharsPerChunk,
                ),
                maxChars: excerptCharsPerChunk,
                sourceKind: "chunk_summaries",
                summaryInstructions,
                signal,
              });
              normalizedSummary = normalizeExcerptText(summary);
            } catch (error) {
              if (isAbortError(error)) throw error;
              emitDigestProgress(
                buildDigestExecutionSummary(),
                formatDigestProgressLog(
                  taskNode,
                  `fallback (${formatErrorMessage(error)})`,
                ),
              );
            }
            return {
              startPage: taskNode.startPage,
              endPage: taskNode.endPage,
              pageCount: childChunks.reduce(
                (sum, chunk) => sum + chunk.pageCount,
                0,
              ),
              charCount: childChunks.reduce(
                (sum, chunk) => sum + chunk.charCount,
                0,
              ),
              excerpt: truncateText(
                normalizedSummary || fallbackExcerpt,
                excerptCharsPerChunk,
              ),
            } satisfies AiDocumentDigestChunk;
          };

          const overallChunk = await new Promise<AiDocumentDigestChunk>(
            (resolve, reject) => {
              const maybeStartNext = () => {
                if (finished) return;
                while (
                  runningTaskCount < AI_CHAT_DIGEST_SUMMARY_CONCURRENCY &&
                  readyQueue.length > 0
                ) {
                  const nextTaskId = readyQueue.shift();
                  if (!nextTaskId) continue;
                  const taskNode = taskNodes.get(nextTaskId);
                  if (!taskNode || taskNode.status !== "pending") continue;

                  queuedTaskIds.delete(nextTaskId);
                  runningTaskCount += 1;
                  updateTaskStatus(nextTaskId, "running");
                  emitDigestProgress(
                    buildDigestExecutionSummary(),
                    formatDigestProgressLog(taskNode, "running"),
                  );

                  void executeTask(taskNode)
                    .then((result) => {
                      if (finished) return;
                      taskNode.result = result;
                      updateTaskStatus(nextTaskId, "done");
                      if (taskNode.parentId) {
                        enqueueTaskIfReady(taskNode.parentId);
                      }
                      const rootNode = taskNodes.get(rootTaskId);
                      if (rootNode?.result) {
                        finished = true;
                        emitDigestProgress(
                          `Digest ready for ${digestRangeLabel}`,
                          formatDigestProgressLog(taskNode, "done"),
                        );
                        resolve(rootNode.result);
                        return;
                      }
                      emitDigestProgress(
                        buildDigestExecutionSummary(),
                        formatDigestProgressLog(taskNode, "done"),
                      );
                    })
                    .catch((error) => {
                      if (finished) return;
                      finished = true;
                      reject(error);
                    })
                    .finally(() => {
                      runningTaskCount = Math.max(0, runningTaskCount - 1);
                      maybeStartNext();
                    });
                }
              };

              maybeStartNext();
            },
          );

          const leafChunks = leafTaskIds
            .map((taskId) => taskNodes.get(taskId)?.result)
            .filter(Boolean);

          const overallExcerpt =
            overallChunk.excerpt ??
            leafChunks[0]?.excerpt ??
            truncateText(
              buildChunkSample(pages, excerptCharsPerChunk),
              excerptCharsPerChunk,
            );

          return {
            pageCount: snapshot.pages.length,
            returnedPageCount: resolvedPageNumbers.length,
            chunkCount: leafChunks.length,
            excerptCharsPerChunk,
            sourceCharsPerChunk: effectiveSourceCharsPerChunk,
            overallExcerpt,
            chunks: leafChunks,
          };
        }
      : undefined,

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
        AI_CHAT_MAX_READ_PAGES_PER_CALL,
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
        maxPagesPerCall: AI_CHAT_MAX_READ_PAGES_PER_CALL,
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
    }: {
      query: string;
      pageNumbers?: number[];
      caseSensitive?: boolean;
      mode?: PDFSearchMode;
      regexFlags?: string;
      maxResults?: number;
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

export type AiDocumentToolContext = ReturnType<
  typeof createDocumentContextService
>;
