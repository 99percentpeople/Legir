import type {
  TextContent,
  TextItem,
  TextMarkedContent,
  TextStyle,
} from "pdfjs-dist/types/src/display/api";
import { pdfWorkerService } from "@/services/pdfService/pdfWorkerService";
import { createViewportFromPageInfo } from "@/services/pdfService/lib/coords";
import type {
  Annotation,
  PageData,
  PageTranslateParagraphCandidate,
} from "@/types";
import {
  translateService,
  type TranslateTextOptions,
} from "@/services/translateService";
import { resolveFontStackForDisplay } from "@/lib/fonts";

export type PageTranslationTextBlock = {
  text: string;
  rect: { x: number; y: number; width: number; height: number };

  fontSize: number;
  fontFamily: string;
};

const buildParagraphCandidatesFromLines = (options: {
  pageIndex: number;
  lines: PageTranslationLine[];
  xGap: number;
  yGap: number;
}): PageTranslateParagraphCandidate[] => {
  const { pageIndex, lines, xGap, yGap } = options;
  const sorted = [...lines].sort((a, b) => {
    const dy = a.rect.y - b.rect.y;
    if (Math.abs(dy) > 0.001) return dy;
    return a.rect.x - b.rect.x;
  });

  const parent = Array.from({ length: sorted.length }, (_, i) => i);
  const find = (i: number): number => {
    let x = i;
    while (parent[x] !== x) x = parent[x]!;
    let cur = i;
    while (parent[cur] !== cur) {
      const next = parent[cur]!;
      parent[cur] = x;
      cur = next;
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const expanded = sorted.map((l) => {
    const fs = Math.max(1, l.fontSize || 12);
    const padX = Math.max(0, fs * xGap);
    const padY = Math.max(0, fs * yGap);
    return expandRect(l.rect, padX, padY);
  });

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    const aPadY = Math.max(0, (a.fontSize || 12) * yGap);
    const aBottom = a.rect.y + a.rect.height + aPadY;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      const bPadY = Math.max(0, (b.fontSize || 12) * yGap);
      const bTop = b.rect.y - bPadY;
      if (bTop > aBottom) break;
      if (rectOverlaps(expanded[i]!, expanded[j]!)) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, PageTranslationLine[]>();
  for (let i = 0; i < sorted.length; i++) {
    const root = find(i);
    const arr = groups.get(root);
    if (arr) arr.push(sorted[i]!);
    else groups.set(root, [sorted[i]!]);
  }

  const out: PageTranslateParagraphCandidate[] = [];
  let idx = 0;
  for (const segLines of groups.values()) {
    const ordered = segLines.slice().sort((a, b) => {
      const dy = a.rect.y - b.rect.y;
      if (Math.abs(dy) > 0.001) return dy;
      return a.rect.x - b.rect.x;
    });

    const rect = unionRect(ordered.map((l) => l.rect));
    const fontFamily =
      pickMostCommon(ordered.map((l) => l.fontFamily)) || "sans-serif";
    const fontSize = median(ordered.map((l) => l.fontSize)) || 12;
    const sourceText = ordered
      .map((l) => l.sourceText)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!sourceText) continue;

    out.push({
      id: `page_translate_paragraph_${pageIndex}_${idx++}`,
      pageIndex,
      rect,
      sourceText,
      fontSize,
      fontFamily,
      isExcluded: false,
    });
  }

  return out.sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
    const dy = a.rect.y - b.rect.y;
    if (Math.abs(dy) > 0.001) return dy;
    return a.rect.x - b.rect.x;
  });
};

export type PageTranslationLine = {
  pageIndex: number;
  sourceText: string;
  rect: { x: number; y: number; width: number; height: number };
  fontSize: number;
  fontFamily: string;
};

export type PageTranslationResult = {
  pageIndex: number;
  lines: Array<
    PageTranslationLine & {
      translatedText: string;
    }
  >;
};

const rectOverlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
};

const expandRect = (
  rect: { x: number; y: number; width: number; height: number },
  padX: number,
  padY: number,
) => {
  return {
    x: rect.x - padX,
    y: rect.y - padY,
    width: rect.width + padX * 2,
    height: rect.height + padY * 2,
  };
};

const createId = (prefix: string) => {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const padRect = (
  rect: { x: number; y: number; width: number; height: number },
  padding: number,
) => {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
};

const normalizeTranslatedText = (text: string) => {
  return text
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
};

const normalizeTranslatedTextPreserveNewlines = (text: string) => {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/\s{2,}/g, " ").trim());
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

let sharedMeasureCtx: CanvasRenderingContext2D | null = null;

const getSharedMeasureCtx = () => {
  if (typeof document === "undefined") return null;
  if (sharedMeasureCtx) return sharedMeasureCtx;

  const canvas = document.createElement("canvas");
  sharedMeasureCtx = canvas.getContext("2d");
  return sharedMeasureCtx;
};

const createMeasureWidth = (fontFamily: string, fontSize: number) => {
  const ctx = getSharedMeasureCtx();
  if (!ctx) {
    return (_s: string) => Number.POSITIVE_INFINITY;
  }

  const family = resolveFontStackForDisplay(fontFamily);
  ctx.font = `${fontSize}px ${family}`;

  return (s: string) => {
    try {
      return ctx.measureText(s).width;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  };
};

const wrapTextToLines = (
  text: string,
  maxWidth: number,
  measureWidth: (s: string) => number,
) => {
  const paragraphs = text.split(/\r\n|\r|\n/);
  const lines: string[] = [];
  const availableWidth = Math.max(0, maxWidth);

  const wrapParagraph = (paragraph: string) => {
    if (paragraph === "") {
      lines.push("");
      return;
    }

    let current = "";
    let lastBreakPos = -1;
    let i = 0;

    const recomputeLastBreakPos = () => {
      lastBreakPos = -1;
      for (let j = current.length - 1; j >= 0; j--) {
        const ch = current[j];
        const code = ch.charCodeAt(0);
        if (ch === " " || ch === "\t" || ch === "-" || code > 0x7f) {
          lastBreakPos = j + 1;
          return;
        }
      }
    };

    while (i < paragraph.length) {
      const ch = paragraph[i];
      const next = current + ch;

      const width = measureWidth(next);
      if (current === "" || width <= availableWidth) {
        current = next;
        const code = ch.charCodeAt(0);
        if (ch === " " || ch === "\t" || ch === "-" || code > 0x7f) {
          lastBreakPos = current.length;
        }
        i += 1;
        continue;
      }

      if (lastBreakPos > 0 && lastBreakPos < current.length) {
        lines.push(current.slice(0, lastBreakPos));
        current = current.slice(lastBreakPos);
        recomputeLastBreakPos();
        continue;
      }
      if (lastBreakPos === current.length) {
        lines.push(current);
        current = "";
        lastBreakPos = -1;
        continue;
      }

      lines.push(current);
      current = "";
      lastBreakPos = -1;
    }

    if (current !== "") lines.push(current);
  };

  for (const paragraph of paragraphs) {
    wrapParagraph(paragraph);
  }

  return lines;
};

const fitPageTranslateFreetext = (options: {
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  fontSize: number;
  fontFamily: string;
  maxHeight?: number;
}) => {
  const maxSize = 200;

  const baseSize = Math.max(4, Math.min(maxSize, options.fontSize || 12));
  const minSize = Math.min(6, baseSize);
  const rect = options.rect;
  const text = options.text;
  const availableWidth = Math.max(1, rect.width);
  const hardMaxHeight =
    typeof options.maxHeight === "number"
      ? Math.max(1, options.maxHeight)
      : Number.POSITIVE_INFINITY;

  const computeWrapHeight = (size: number) => {
    const measure = createMeasureWidth(options.fontFamily, size);
    const lines = wrapTextToLines(text, availableWidth, measure);
    const requiredHeight = lines.length * size + 2;
    return { requiredHeight, linesCount: lines.length };
  };

  const base = computeWrapHeight(baseSize);
  if (base.requiredHeight <= rect.height) {
    return { rect, size: baseSize, text };
  }

  const maxExpandHeight = Math.min(
    rect.height + 400,
    Math.max(rect.height * 8, baseSize * 12 + 2),
  );

  const allowedExpandHeight = Math.min(maxExpandHeight, hardMaxHeight);

  if (base.requiredHeight <= allowedExpandHeight) {
    return {
      rect: { ...rect, height: base.requiredHeight },
      size: baseSize,
      text,
    };
  }

  const targetHeight = Math.min(
    hardMaxHeight,
    Math.max(rect.height, allowedExpandHeight),
  );

  let lo = Math.floor(minSize);
  let hi = Math.floor(baseSize);
  let best = lo;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const { requiredHeight } = computeWrapHeight(mid);
    if (requiredHeight <= targetHeight) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const chosen = computeWrapHeight(best);
  return {
    rect:
      chosen.requiredHeight > rect.height
        ? { ...rect, height: Math.min(targetHeight, chosen.requiredHeight) }
        : rect,
    size: best,
    text,
  };
};

export const isPageTranslateAnnotation = (a: Annotation) => {
  return a.meta?.kind === "page_translate";
};

const DEFAULT_TEXT_STYLE: TextStyle = {
  ascent: 0.8,
  descent: -0.2,
  vertical: false,
  fontFamily: "sans-serif",
};

const transform = (m1: number[], m2: number[]) => {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
};

const isMarkedContent = (
  item: TextItem | TextMarkedContent,
): item is TextMarkedContent => !("str" in item);

const getItemTransform = (item: TextItem) => {
  if (Array.isArray(item.transform) && item.transform.length >= 6) {
    return item.transform as number[];
  }
  return [1, 0, 0, 1, 0, 0];
};

const getFontSubstitution = (style: TextStyle) => {
  const maybe = style as TextStyle & { fontSubstitution?: string };
  if (typeof maybe.fontSubstitution !== "string") return undefined;
  const trimmed = maybe.fontSubstitution.trim();
  return trimmed ? trimmed : undefined;
};

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
};

const pickMostCommon = (values: string[]) => {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: { v: string; n: number } | null = null;
  for (const [v, n] of counts.entries()) {
    if (!best || n > best.n) best = { v, n };
  }
  return best?.v;
};

const unionRect = (
  rects: Array<{ x: number; y: number; width: number; height: number }>,
) => {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
};

const extractTextBlocks = (textContent: TextContent, page: PageData) => {
  const viewport = createViewportFromPageInfo(
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

  const viewBox = viewport.viewBox;
  if (!viewBox) return [] as PageTranslationTextBlock[];

  const pageX = viewBox[0];
  const pageY = viewBox[1];
  const pageWidth = viewBox[2] - viewBox[0];
  const pageHeight = viewBox[3] - viewBox[1];

  if (!pageWidth || !pageHeight) return [] as PageTranslationTextBlock[];

  const textLayerTransform = [1, 0, 0, -1, -pageX, pageY + pageHeight];

  const blocks: PageTranslationTextBlock[] = [];

  for (const item of textContent.items) {
    if (isMarkedContent(item)) continue;

    const str = item.str ?? "";
    if (!str || str.trim().length === 0) continue;

    const itemTransform = getItemTransform(item);
    const tx = transform(textLayerTransform, itemTransform);

    let angle = Math.atan2(tx[1], tx[0]);

    const style = textContent.styles[item.fontName] ?? DEFAULT_TEXT_STYLE;
    if (style.vertical) {
      angle += Math.PI / 2;
    }
    const fontFamily =
      getFontSubstitution(style) || style.fontFamily || "sans-serif";

    const fontHeight = Math.hypot(tx[2], tx[3]);
    if (!Number.isFinite(fontHeight) || fontHeight <= 0) continue;

    const ascentRatio = (() => {
      if (Number.isFinite(style.ascent)) return style.ascent;
      if (Number.isFinite(style.descent)) return 1 + style.descent;
      return 0.8;
    })();
    const fontAscent = fontHeight * ascentRatio;

    const vertical = Boolean(style.vertical);
    const width = vertical ? (item.height ?? 0) : (item.width ?? 0);

    let left: number;
    let top: number;
    if (angle === 0) {
      left = tx[4];
      top = tx[5] - fontAscent;
    } else {
      left = tx[4] + fontAscent * Math.sin(angle);
      top = tx[5] - fontAscent * Math.cos(angle);
    }

    const pdfX = left + pageX;
    const pdfYTop = pageY + pageHeight - top;
    const pdfYBottom = pdfYTop - fontHeight;

    const cornerPoints = [
      viewport.convertToViewportPoint(pdfX, pdfYTop),
      viewport.convertToViewportPoint(pdfX + width, pdfYTop),
      viewport.convertToViewportPoint(pdfX, pdfYBottom),
      viewport.convertToViewportPoint(pdfX + width, pdfYBottom),
    ];

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const [vx, vy] of cornerPoints) {
      minX = Math.min(minX, vx);
      minY = Math.min(minY, vy);
      maxX = Math.max(maxX, vx);
      maxY = Math.max(maxY, vy);
    }

    const rect = {
      x: minX,
      y: minY,
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    };

    blocks.push({
      text: str,
      rect,
      fontSize: fontHeight * (page.userUnit ?? 1),
      fontFamily,
    });
  }

  return blocks;
};

const buildLinesFromBlocks = (
  pageIndex: number,
  blocks: PageTranslationTextBlock[],
) => {
  const sorted = [...blocks].sort((a, b) => {
    const dy = a.rect.y - b.rect.y;
    if (Math.abs(dy) > 0.001) return dy;
    return a.rect.x - b.rect.x;
  });

  const lines: Array<{
    blocks: PageTranslationTextBlock[];
    y: number;
    fontSize: number;
  }> = [];

  for (const b of sorted) {
    const size = b.fontSize || 1;
    const threshold = Math.max(2, size * 0.6);

    const target = lines.find((l) => Math.abs(b.rect.y - l.y) <= threshold);
    if (!target) {
      lines.push({ blocks: [b], y: b.rect.y, fontSize: size });
      continue;
    }

    target.blocks.push(b);
    target.y = median(target.blocks.map((x) => x.rect.y));
    target.fontSize = median(target.blocks.map((x) => x.fontSize));
  }

  return lines
    .flatMap((l) => {
      const blocksSorted = [...l.blocks].sort((a, b) => a.rect.x - b.rect.x);

      const segments: PageTranslationTextBlock[][] = [];
      let current: PageTranslationTextBlock[] = [];

      for (let i = 0; i < blocksSorted.length; i++) {
        const b = blocksSorted[i]!;
        if (current.length === 0) {
          current = [b];
          continue;
        }

        const prev = current[current.length - 1]!;
        const gap = b.rect.x - (prev.rect.x + prev.rect.width);
        const splitThreshold = Math.max(10, l.fontSize * 2.5);
        if (gap > splitThreshold) {
          segments.push(current);
          current = [b];
          continue;
        }

        current.push(b);
      }
      if (current.length > 0) segments.push(current);

      return segments
        .map((seg) => {
          const rect = unionRect(seg.map((b) => b.rect));
          const fontFamily =
            pickMostCommon(seg.map((b) => b.fontFamily)) || "sans-serif";
          const fontSize =
            median(seg.map((b) => b.fontSize)) || l.fontSize || 12;

          let text = "";
          for (let i = 0; i < seg.length; i++) {
            const curr = seg[i]!;
            if (i === 0) {
              text += curr.text;
              continue;
            }

            const prev = seg[i - 1]!;
            const gap = curr.rect.x - (prev.rect.x + prev.rect.width);
            const shouldSpace = gap > Math.max(1, fontSize * 0.25);
            text += (shouldSpace ? " " : "") + curr.text;
          }

          return {
            pageIndex,
            sourceText: text.trim(),
            rect,
            fontSize,
            fontFamily,
          } satisfies PageTranslationLine;
        })
        .filter((l) => l.sourceText.length > 0);
    })
    .filter((l) => l.sourceText.length > 0);
};

const translateTextCollectingStream = async (
  text: string,
  opts: TranslateTextOptions,
) => {
  let out = "";
  for await (const chunk of translateService.translateStream(text, opts)) {
    out += chunk;
  }
  return out.trim();
};

const buildPositionAwarePrompt = (args: {
  page: PageData;
  rect: { x: number; y: number; width: number; height: number };
  fontSize: number;
  allowLineBreaks?: boolean;
}) => {
  const { page, rect, fontSize, allowLineBreaks } = args;
  const w = Math.max(0, rect.width);
  const h = Math.max(0, rect.height);
  const relW = page.width > 0 ? w / page.width : 0;
  const relH = page.height > 0 ? h / page.height : 0;
  const approxCharsPerLine =
    fontSize > 0 ? Math.max(1, Math.floor(w / (fontSize * 0.6))) : 0;

  return (
    "Layout constraints (for this one line):\n" +
    `- Page size: ${page.width.toFixed(2)} x ${page.height.toFixed(2)}\n` +
    `- Target bbox (x,y,w,h): ${rect.x.toFixed(2)}, ${rect.y.toFixed(2)}, ${w.toFixed(2)}, ${h.toFixed(2)}\n` +
    `- Font size (pt-ish): ${Math.round(fontSize)}\n` +
    `- Relative bbox (w%, h%): ${(relW * 100).toFixed(1)}%, ${(relH * 100).toFixed(1)}%\n` +
    (approxCharsPerLine > 0
      ? `- Approx max chars per line: ${approxCharsPerLine}\n`
      : "") +
    "Rules:\n" +
    "- Prefer a concise translation that fits the bbox width.\n" +
    (allowLineBreaks
      ? "- Preserve existing line breaks. Do NOT add extra line breaks.\n"
      : "- Do NOT add line breaks. Output a single line only.\n") +
    "- Do not add extra commentary."
  );
};

export const pageTranslationService = {
  buildPositionAwarePrompt,

  extractLinesFromTextLayer: async (options: {
    pageIndex: number;
    page: PageData;
    docId?: string;
    signal?: AbortSignal;
  }): Promise<PageTranslationLine[]> => {
    const { pageIndex, page, docId, signal } = options;

    const textContent = await pdfWorkerService.getTextContent({
      pageIndex,
      docId,
      signal,
    });

    if (!textContent) return [];

    const blocks = extractTextBlocks(textContent, page);
    return buildLinesFromBlocks(pageIndex, blocks);
  },

  extractParagraphCandidatesFromTextLayer: async (options: {
    pageIndex: number;
    page: PageData;
    xGap: number;
    yGap: number;
    docId?: string;
    signal?: AbortSignal;
  }): Promise<PageTranslateParagraphCandidate[]> => {
    const { pageIndex, page, xGap, yGap, docId, signal } = options;
    const lines = await pageTranslationService.extractLinesFromTextLayer({
      pageIndex,
      page,
      docId,
      signal,
    });
    return buildParagraphCandidatesFromLines({
      pageIndex,
      lines,
      xGap,
      yGap,
    });
  },

  translatePagesFromTextLayer: async (options: {
    pages: PageData[];
    pageIndices: number[];
    translate: {
      targetLanguage: string;
      sourceLanguage?: string;
      translateOption?: TranslateTextOptions["translateOption"];
      prompt?: string;
    };
    usePositionAwarePrompt?: boolean;
    docId?: string;
    signal?: AbortSignal;
    onProgress?: (info: {
      pageIndex: number;
      pageNumber: number;
      totalPages: number;
      lineIndex: number;
      totalLines: number;
    }) => void;
  }): Promise<PageTranslationResult[]> => {
    const { pages, pageIndices, translate, docId, signal, onProgress } =
      options;

    const results: PageTranslationResult[] = [];

    for (let p = 0; p < pageIndices.length; p++) {
      const pageIndex = pageIndices[p]!;
      const page = pages[pageIndex];
      if (!page) continue;

      const lines = await pageTranslationService.extractLinesFromTextLayer({
        pageIndex,
        page,
        docId,
        signal,
      });

      const translatedLines: PageTranslationResult["lines"] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        onProgress?.({
          pageIndex,
          pageNumber: p + 1,
          totalPages: pageIndices.length,
          lineIndex: i + 1,
          totalLines: lines.length,
        });

        const perLinePrompt = (() => {
          const base = (translate.prompt || "").trim();
          if (!options.usePositionAwarePrompt) return base || undefined;
          const extra = buildPositionAwarePrompt({
            page,
            rect: line.rect,
            fontSize: line.fontSize || 12,
          });
          if (!base) return extra;
          return `${base}\n\n${extra}`;
        })();

        const translatedText = await translateTextCollectingStream(
          line.sourceText,
          {
            targetLanguage: translate.targetLanguage,
            sourceLanguage: translate.sourceLanguage,
            translateOption: translate.translateOption,
            prompt: perLinePrompt,
            signal,
          },
        );

        translatedLines.push({
          ...line,
          translatedText,
        });
      }

      results.push({ pageIndex, lines: translatedLines });
    }

    return results;
  },

  buildFreetextAnnotationsFromTranslation: (options: {
    results: PageTranslationResult[];
    pages?: PageData[];
    translate: {
      targetLanguage: string;
      sourceLanguage?: string;
      translateOption?: TranslateTextOptions["translateOption"];
      prompt?: string;
    };
    source: "text_layer" | "ocr";
    granularity?: "line" | "paragraph";
    fontFamily?: string;
    padding?: number;
    flattenFreetext?: boolean;
  }): Annotation[] => {
    const { results, translate, source } = options;
    const padding = options.padding ?? 1;

    const forcedFontFamily = (options.fontFamily || "").trim() || "Helvetica";

    const createdAt = new Date().toISOString();

    const annots: Annotation[] = [];
    for (const page of results) {
      const pageSize = options.pages?.[page.pageIndex];
      const pageWidth = pageSize?.width;
      const pageHeight = pageSize?.height;

      const occupiedRects = page.lines.map((l) => padRect(l.rect, padding));

      for (let i = 0; i < page.lines.length; i++) {
        const line = page.lines[i]!;

        const isParagraphGranularity = options.granularity === "paragraph";

        const normalizedText =
          options.granularity === "paragraph"
            ? normalizeTranslatedTextPreserveNewlines(line.translatedText)
            : normalizeTranslatedText(line.translatedText);
        const paddedRect = padRect(line.rect, padding);

        const baseSize = Math.max(4, Math.min(200, line.fontSize || 12));
        const measureAtBase = createMeasureWidth(forcedFontFamily, baseSize);
        const hasExplicitLineBreaks = normalizedText.includes("\n");
        const isMultiLineByRect =
          isParagraphGranularity && line.rect.height >= baseSize * 1.6;
        const preferVerticalExpansion =
          isParagraphGranularity &&
          (hasExplicitLineBreaks || isMultiLineByRect);

        const singleLineWidth = preferVerticalExpansion
          ? Number.POSITIVE_INFINITY
          : measureAtBase(normalizedText);

        const maxRightX = (() => {
          let limit =
            typeof pageWidth === "number"
              ? pageWidth - padding
              : paddedRect.x + paddedRect.width + 400;

          for (let j = 0; j < occupiedRects.length; j++) {
            if (j === i) continue;
            const r = occupiedRects[j]!;
            const verticalOverlaps =
              paddedRect.y < r.y + r.height &&
              paddedRect.y + paddedRect.height > r.y;
            if (!verticalOverlaps) continue;
            if (r.x <= paddedRect.x + paddedRect.width) continue;
            limit = Math.min(limit, r.x - 1);
          }

          return Math.max(paddedRect.x + 1, limit);
        })();

        const maxWidth = Math.max(1, maxRightX - paddedRect.x);

        const maxHorizRect = {
          ...paddedRect,
          width: Math.max(paddedRect.width, maxWidth),
        };

        const horizExpandedRect = preferVerticalExpansion
          ? paddedRect
          : {
              ...paddedRect,
              width:
                Number.isFinite(singleLineWidth) && singleLineWidth > 0
                  ? Math.max(
                      paddedRect.width,
                      Math.min(maxWidth, Math.ceil(singleLineWidth)),
                    )
                  : Math.max(paddedRect.width, maxWidth),
            };

        const canFitSingleLineAtBase =
          !preferVerticalExpansion &&
          Number.isFinite(singleLineWidth) &&
          singleLineWidth > 0 &&
          singleLineWidth <= maxWidth;

        const maxBottomY = (() => {
          let limit =
            typeof pageHeight === "number"
              ? pageHeight - padding
              : paddedRect.y + paddedRect.height + 400;

          for (let j = 0; j < occupiedRects.length; j++) {
            if (j === i) continue;
            const r = occupiedRects[j]!;
            const horizontalOverlaps =
              horizExpandedRect.x < r.x + r.width &&
              horizExpandedRect.x + horizExpandedRect.width > r.x;
            if (!horizontalOverlaps) continue;
            if (r.y <= paddedRect.y + paddedRect.height) continue;
            limit = Math.min(limit, r.y - 1);
          }

          return Math.max(paddedRect.y + 1, limit);
        })();

        const maxHeight = Math.max(1, maxBottomY - paddedRect.y);

        const maxBottomYWithMaxHoriz = (() => {
          let limit =
            typeof pageHeight === "number"
              ? pageHeight - padding
              : paddedRect.y + paddedRect.height + 400;

          for (let j = 0; j < occupiedRects.length; j++) {
            if (j === i) continue;
            const r = occupiedRects[j]!;
            const horizontalOverlaps =
              maxHorizRect.x < r.x + r.width &&
              maxHorizRect.x + maxHorizRect.width > r.x;
            if (!horizontalOverlaps) continue;
            if (r.y <= paddedRect.y + paddedRect.height) continue;
            limit = Math.min(limit, r.y - 1);
          }

          return Math.max(paddedRect.y + 1, limit);
        })();

        const maxHeightWithMaxHoriz = Math.max(
          1,
          maxBottomYWithMaxHoriz - paddedRect.y,
        );

        const computeWrapRequiredHeight = (args: { width: number }) => {
          const lines = wrapTextToLines(
            normalizedText,
            Math.max(1, args.width),
            measureAtBase,
          );
          return lines.length * baseSize + 2;
        };

        const canFitWrappedAtBaseWithinMaxHeight = (() => {
          if (!Number.isFinite(maxHeight) || maxHeight <= 0) return false;
          const measure = createMeasureWidth(forcedFontFamily, baseSize);
          const lines = wrapTextToLines(
            normalizedText,
            Math.max(1, horizExpandedRect.width),
            measure,
          );
          const requiredHeight = lines.length * baseSize + 2;
          return requiredHeight <= maxHeight;
        })();

        const shrinkToSingleLine = () => {
          if (!Number.isFinite(singleLineWidth) || singleLineWidth <= 0) {
            return null;
          }
          const scale = maxWidth / singleLineWidth;
          let size = Math.floor(baseSize * scale);
          size = Math.max(4, Math.min(baseSize, size));

          let widthAtSize = Number.POSITIVE_INFINITY;
          while (size > 4) {
            const m = createMeasureWidth(forcedFontFamily, size);
            widthAtSize = m(normalizedText);
            if (Number.isFinite(widthAtSize) && widthAtSize <= maxWidth) break;
            size -= 1;
          }
          if (!Number.isFinite(widthAtSize)) {
            const m = createMeasureWidth(forcedFontFamily, size);
            widthAtSize = m(normalizedText);
          }
          const safeWidth =
            Number.isFinite(widthAtSize) && widthAtSize > 0
              ? Math.max(
                  paddedRect.width,
                  Math.min(maxWidth, Math.ceil(widthAtSize)),
                )
              : Math.max(paddedRect.width, maxWidth);

          return {
            rect: {
              ...horizExpandedRect,
              width: safeWidth,
              height: paddedRect.height,
            },
            size,
            text: normalizedText,
          };
        };

        const fitted = (() => {
          if (!preferVerticalExpansion) {
            return canFitSingleLineAtBase
              ? {
                  rect: horizExpandedRect,
                  size: baseSize,
                  text: normalizedText,
                }
              : canFitWrappedAtBaseWithinMaxHeight
                ? fitPageTranslateFreetext({
                    text: normalizedText,
                    rect: horizExpandedRect,
                    fontSize: baseSize,
                    fontFamily: forcedFontFamily,
                    maxHeight,
                  })
                : (shrinkToSingleLine() ??
                  fitPageTranslateFreetext({
                    text: normalizedText,
                    rect: horizExpandedRect,
                    fontSize: baseSize,
                    fontFamily: forcedFontFamily,
                    maxHeight,
                  }));
          }

          const requiredHeightNoHoriz = computeWrapRequiredHeight({
            width: paddedRect.width,
          });

          if (requiredHeightNoHoriz <= paddedRect.height) {
            return { rect: paddedRect, size: baseSize, text: normalizedText };
          }

          if (requiredHeightNoHoriz <= maxHeight) {
            return fitPageTranslateFreetext({
              text: normalizedText,
              rect: paddedRect,
              fontSize: baseSize,
              fontFamily: forcedFontFamily,
              maxHeight,
            });
          }

          const requiredHeightWithMaxHoriz = computeWrapRequiredHeight({
            width: maxHorizRect.width,
          });

          if (requiredHeightWithMaxHoriz <= maxHeightWithMaxHoriz) {
            return fitPageTranslateFreetext({
              text: normalizedText,
              rect: maxHorizRect,
              fontSize: baseSize,
              fontFamily: forcedFontFamily,
              maxHeight: maxHeightWithMaxHoriz,
            });
          }

          return fitPageTranslateFreetext({
            text: normalizedText,
            rect: maxHorizRect,
            fontSize: baseSize,
            fontFamily: forcedFontFamily,
            maxHeight: maxHeightWithMaxHoriz,
          });
        })();

        annots.push({
          id: createId(`page_translate_${page.pageIndex}_${i}`),
          pageIndex: page.pageIndex,
          type: "freetext",
          rect: fitted.rect,
          text: fitted.text,
          size: fitted.size,
          fontFamily: forcedFontFamily,
          color: "#000000",
          backgroundColor: "#ffffff",
          opacity: 1,
          flatten: options.flattenFreetext,
          meta: {
            kind: "page_translate",
            source,
            granularity: options.granularity,
            targetLanguage: translate.targetLanguage,
            sourceLanguage: translate.sourceLanguage,
            translateOption: translate.translateOption,
            prompt: translate.prompt,
            createdAt,
          },
        });
      }
    }

    return annots;
  },

  translatePagesToFreetextAnnotationsFromTextLayer: async (options: {
    pages: PageData[];
    pageIndices: number[];
    translate: {
      targetLanguage: string;
      sourceLanguage?: string;
      translateOption?: TranslateTextOptions["translateOption"];
      prompt?: string;
    };
    fontFamily?: string;
    usePositionAwarePrompt?: boolean;
    flattenFreetext?: boolean;
    docId?: string;
    signal?: AbortSignal;
    padding?: number;
    onProgress?: (info: {
      pageIndex: number;
      pageNumber: number;
      totalPages: number;
      lineIndex: number;
      totalLines: number;
    }) => void;
  }): Promise<Annotation[]> => {
    const results = await pageTranslationService.translatePagesFromTextLayer({
      pages: options.pages,
      pageIndices: options.pageIndices,
      translate: options.translate,
      usePositionAwarePrompt: options.usePositionAwarePrompt,
      docId: options.docId,
      signal: options.signal,
      onProgress: options.onProgress,
    });

    return pageTranslationService.buildFreetextAnnotationsFromTranslation({
      results,
      pages: options.pages,
      translate: options.translate,
      source: "text_layer",
      fontFamily: options.fontFamily,
      padding: options.padding,
      flattenFreetext: options.flattenFreetext,
    });
  },
};
