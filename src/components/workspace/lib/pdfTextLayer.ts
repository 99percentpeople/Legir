import type { TextContent, TextStyle } from "pdfjs-dist/types/src/display/api";
import {
  DEFAULT_PDF_TEXT_STYLE,
  getItemTransform,
  isMarkedContent,
  transform,
} from "@/services/pdfService/lib/textGeometry";
import type { ViewportLike } from "@/services/pdfService/types";

const MAX_TEXT_DIVS_TO_RENDER = 100000;
const DEFAULT_FONT_SIZE = 30;
// Paper-like PDFs often have thousands of text items on a normal-sized page.
// Above this threshold, per-item measureText becomes a visible main-thread cost.
const DENSE_TEXT_LAYER_ITEM_THRESHOLD = 1500;

const ascentCache = new Map<string, number>();
const normalizedTextWidthCache = new WeakMap<
  TextContent,
  Array<number | null>
>();

let minFontSize: number | null = null;
let textLayerCtx: CanvasRenderingContext2D | null = null;
let ctxFontState: { size: number; family: string } | null = null;

const getMinFontSize = () => {
  if (minFontSize !== null) return minFontSize;
  if (typeof document === "undefined") return 1;
  const div = document.createElement("div");
  div.style.opacity = "0";
  div.style.lineHeight = "1";
  div.style.fontSize = "1px";
  div.style.position = "absolute";
  div.textContent = "X";
  document.body.append(div);
  minFontSize = div.getBoundingClientRect().height || 1;
  div.remove();
  return minFontSize;
};

const getTextLayerContext = () => {
  if (textLayerCtx) return textLayerCtx;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.className = "hiddenCanvasElement";
  document.body.append(canvas);
  textLayerCtx = canvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true,
  });
  ctxFontState = { size: 0, family: "" };
  return textLayerCtx;
};

const ensureCtxFont = (
  ctx: CanvasRenderingContext2D,
  size: number,
  family: string,
) => {
  if (!ctxFontState) ctxFontState = { size: 0, family: "" };
  if (ctxFontState.size === size && ctxFontState.family === family) return;
  ctx.font = `${size}px ${family}`;
  ctxFontState.size = size;
  ctxFontState.family = family;
};

const getFontSubstitution = (style: TextStyle) => {
  const maybe = style as TextStyle & { fontSubstitution?: string };
  if (typeof maybe.fontSubstitution !== "string") return undefined;
  const trimmed = maybe.fontSubstitution.trim();
  return trimmed ? trimmed : undefined;
};

const getNormalizedTextWidthCache = (textContent: TextContent) => {
  let cache = normalizedTextWidthCache.get(textContent);
  if (cache) return cache;
  cache = [];
  normalizedTextWidthCache.set(textContent, cache);
  return cache;
};

const getNormalizedTextWidth = (options: {
  textContent: TextContent;
  itemIndex: number;
  fontFamily: string;
  fontSize: number;
  text: string;
  lang: string | null;
}) => {
  const { textContent, itemIndex, fontFamily, fontSize, text, lang } = options;
  const cache = getNormalizedTextWidthCache(textContent);
  const cached = cache[itemIndex];
  if (typeof cached === "number") {
    return cached > 0 ? cached : null;
  }

  const ctx = getTextLayerContext();
  if (!ctx || !text || !(fontSize > 0)) {
    cache[itemIndex] = 0;
    return null;
  }

  if (lang) ctx.canvas.lang = lang;
  ensureCtxFont(ctx, fontSize, fontFamily);
  const measuredWidth = ctx.measureText(text).width;
  if (!(measuredWidth > 0)) {
    cache[itemIndex] = 0;
    return null;
  }

  const normalizedWidth = measuredWidth / fontSize;
  cache[itemIndex] = normalizedWidth;
  return normalizedWidth;
};

const getAscent = (
  fontFamily: string,
  style: TextStyle,
  lang: string | null,
) => {
  const cached = ascentCache.get(fontFamily);
  if (cached) return cached;

  let ratio = 0.8;
  const ctx = getTextLayerContext();
  if (ctx) {
    if (lang) ctx.canvas.lang = lang;
    ctx.canvas.width = ctx.canvas.height = DEFAULT_FONT_SIZE;
    ensureCtxFont(ctx, DEFAULT_FONT_SIZE, fontFamily);
    const metrics = ctx.measureText("");
    const ascent = metrics.fontBoundingBoxAscent;
    const descent = Math.abs(metrics.fontBoundingBoxDescent);
    ctx.canvas.width = ctx.canvas.height = 0;
    if (ascent) {
      ratio = ascent / (ascent + descent);
    } else if (Number.isFinite(style.ascent)) {
      ratio = style.ascent;
    } else if (Number.isFinite(style.descent)) {
      ratio = 1 + style.descent;
    }
  } else if (Number.isFinite(style.ascent)) {
    ratio = style.ascent;
  } else if (Number.isFinite(style.descent)) {
    ratio = 1 + style.descent;
  }

  ascentCache.set(fontFamily, ratio);
  return ratio;
};

const getRawDims = (viewport: ViewportLike) => {
  const viewBox = viewport.viewBox;
  if (viewBox) {
    return {
      pageX: viewBox[0],
      pageY: viewBox[1],
      pageWidth: viewBox[2] - viewBox[0],
      pageHeight: viewBox[3] - viewBox[1],
    };
  }

  const userUnit = viewport.userUnit ?? 1;
  const scale = viewport.scale || 1;
  return {
    pageX: 0,
    pageY: 0,
    pageWidth: viewport.width / (scale * userUnit),
    pageHeight: viewport.height / (scale * userUnit),
  };
};

const setLayerDimensions = (div: HTMLElement, viewport: ViewportLike) => {
  const { pageWidth, pageHeight } = getRawDims(viewport);
  const w = `calc(var(--total-scale-factor) * ${pageWidth}px)`;
  const h = `calc(var(--total-scale-factor) * ${pageHeight}px)`;
  div.style.width = w;
  div.style.height = h;
  div.setAttribute("data-main-rotation", String(viewport.rotation ?? 0));
};

const setTextDivStyles = (options: {
  textDiv: HTMLSpanElement;
  leftPct: string;
  topPct: string;
  fontHeightPx: string;
  fontFamily: string;
  scaleX?: number | null;
  rotateDeg?: number | null;
}) => {
  const {
    textDiv,
    leftPct,
    topPct,
    fontHeightPx,
    fontFamily,
    scaleX,
    rotateDeg,
  } = options;
  const styleParts = [
    `left:${leftPct}`,
    `top:${topPct}`,
    `--font-height:${fontHeightPx}`,
  ];
  if (typeof scaleX === "number" && Number.isFinite(scaleX) && scaleX > 0) {
    styleParts.push(`--scale-x:${scaleX}`);
  }
  if (
    typeof rotateDeg === "number" &&
    Number.isFinite(rotateDeg) &&
    rotateDeg !== 0
  ) {
    styleParts.push(`--rotate:${rotateDeg}deg`);
  }
  textDiv.style.cssText = styleParts.join(";");
  textDiv.style.fontFamily = fontFamily;
};

export const buildTextLayer = (
  container: HTMLDivElement,
  textContent: TextContent,
  viewport: ViewportLike,
) => {
  if (textContent.items.length > MAX_TEXT_DIVS_TO_RENDER) return;

  const { pageX, pageY, pageWidth, pageHeight } = getRawDims(viewport);
  if (!pageWidth || !pageHeight) return;

  const minSize = getMinFontSize();
  container.style.setProperty("--min-font-size", String(minSize));
  setLayerDimensions(container, viewport);

  const textLayerTransform = [1, 0, 0, -1, -pageX, pageY + pageHeight];
  const layoutScale =
    viewport.scale *
    (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  const isDenseTextPage =
    textContent.items.length >= DENSE_TEXT_LAYER_ITEM_THRESHOLD;

  let currentContainer: HTMLElement = container;
  let textDivCount = 0;

  for (const [itemIndex, item] of textContent.items.entries()) {
    if (textDivCount > MAX_TEXT_DIVS_TO_RENDER) break;

    if (isMarkedContent(item)) {
      const type = item.type;
      if (type === "beginMarkedContentProps" || type === "beginMarkedContent") {
        const span = document.createElement("span");
        span.classList.add("markedContent");
        if (item.id) span.setAttribute("id", String(item.id));
        currentContainer.append(span);
        currentContainer = span;
      } else if (
        type === "endMarkedContent" &&
        currentContainer.parentNode instanceof HTMLElement
      ) {
        currentContainer = currentContainer.parentNode;
      }
      continue;
    }

    textDivCount += 1;

    const itemTransform = getItemTransform(item);
    const tx = transform(textLayerTransform, itemTransform);
    let angle = Math.atan2(tx[1], tx[0]);

    const style = textContent.styles[item.fontName] ?? DEFAULT_PDF_TEXT_STYLE;
    if (style.vertical) {
      angle += Math.PI / 2;
    }

    const fontFamily =
      getFontSubstitution(style) || style.fontFamily || "sans-serif";
    const fontHeight = Math.hypot(tx[2], tx[3]);
    const fontAscent =
      fontHeight * getAscent(fontFamily, style, textContent.lang);

    let left: number;
    let top: number;
    if (angle === 0) {
      left = tx[4];
      top = tx[5] - fontAscent;
    } else {
      left = tx[4] + fontAscent * Math.sin(angle);
      top = tx[5] - fontAscent * Math.cos(angle);
    }

    const textDiv = document.createElement("span");
    textDiv.setAttribute("role", "presentation");
    textDiv.textContent = item.str;
    textDiv.dir = item.dir || "ltr";

    const hasText = item.str !== "";
    let shouldScaleText = item.str.length > 1;
    if (
      !shouldScaleText &&
      item.str !== " " &&
      itemTransform.length > 3 &&
      itemTransform[0] !== itemTransform[3]
    ) {
      const absScaleX = Math.abs(itemTransform[0]);
      const absScaleY = Math.abs(itemTransform[3]);
      if (
        absScaleX !== absScaleY &&
        Math.max(absScaleX, absScaleY) / Math.min(absScaleX, absScaleY) > 1.5
      ) {
        shouldScaleText = true;
      }
    }

    const canvasWidth = shouldScaleText
      ? style.vertical
        ? item.height || 0
        : item.width || 0
      : 0;

    // For dense horizontal text pages, rely on the browser text box width instead of
    // re-measuring every run. Rotated/vertical text keeps precise scaling.
    const shouldMeasureTextWidth =
      canvasWidth !== 0 &&
      hasText &&
      (!isDenseTextPage || style.vertical || angle !== 0);
    let scaleX: number | null = null;

    if (shouldMeasureTextWidth) {
      const normalizedWidth = getNormalizedTextWidth({
        textContent,
        itemIndex,
        fontFamily,
        fontSize: fontHeight * layoutScale,
        text: textDiv.textContent || "",
        lang: textContent.lang,
      });
      if (normalizedWidth && fontHeight > 0) {
        scaleX = canvasWidth / (normalizedWidth * fontHeight);
      }
    }

    const rotateDeg = angle !== 0 ? (angle * 180) / Math.PI : null;
    setTextDivStyles({
      textDiv,
      leftPct: `${((100 * left) / pageWidth).toFixed(2)}%`,
      topPct: `${((100 * top) / pageHeight).toFixed(2)}%`,
      fontHeightPx: `${fontHeight.toFixed(2)}px`,
      fontFamily,
      scaleX,
      rotateDeg,
    });

    if (hasText) {
      currentContainer.append(textDiv);
    }

    if (item.hasEOL) {
      const br = document.createElement("br");
      br.setAttribute("role", "presentation");
      currentContainer.append(br);
    }
  }
};
