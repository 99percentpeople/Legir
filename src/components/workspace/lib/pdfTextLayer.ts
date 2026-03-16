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

const ascentCache = new Map<string, number>();

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
  const ctx = getTextLayerContext();

  let currentContainer: HTMLElement = container;
  let textDivCount = 0;

  for (const item of textContent.items) {
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
    const divStyle = textDiv.style;
    divStyle.left = `${((100 * left) / pageWidth).toFixed(2)}%`;
    divStyle.top = `${((100 * top) / pageHeight).toFixed(2)}%`;
    divStyle.setProperty("--font-height", `${fontHeight.toFixed(2)}px`);
    divStyle.fontFamily = fontFamily;
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

    if (canvasWidth !== 0 && hasText && ctx) {
      ensureCtxFont(ctx, fontHeight * layoutScale, fontFamily);
      const measured = ctx.measureText(textDiv.textContent || "");
      if (measured.width > 0) {
        divStyle.setProperty(
          "--scale-x",
          String((canvasWidth * layoutScale) / measured.width),
        );
      }
    }

    if (angle !== 0) {
      divStyle.setProperty("--rotate", `${(angle * 180) / Math.PI}deg`);
    }

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
