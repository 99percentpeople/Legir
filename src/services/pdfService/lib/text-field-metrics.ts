import type { PDFFont } from "@cantoo/pdf-lib";
import { DEFAULT_FORM_TEXT_VISUAL_CENTER_ABOVE_BASELINE_EM } from "@/lib/fonts";

type FontkitBBoxLike = {
  minY?: unknown;
  maxY?: unknown;
};

type FontkitGlyphLike = {
  bbox?: FontkitBBoxLike;
};

type FontkitPositionLike = {
  yOffset?: unknown;
};

type FontkitRunLike = {
  glyphs?: FontkitGlyphLike[];
  positions?: FontkitPositionLike[];
};

type FontkitFontLike = {
  unitsPerEm?: unknown;
  ascent?: unknown;
  descent?: unknown;
  bbox?: FontkitBBoxLike;
  layout?: (text: string, features?: unknown) => FontkitRunLike;
};

type FontkitEmbedderLike = {
  font?: FontkitFontLike;
  scale?: unknown;
  fontFeatures?: unknown;
};

type StandardFontLike = {
  Ascender?: unknown;
  CapHeight?: unknown;
  FontBBox?: unknown;
};

type StandardFontEmbedderLike = {
  font?: StandardFontLike;
};

type PdfFontWithEmbedder = {
  embedder?: FontkitEmbedderLike | StandardFontEmbedderLike;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const toFiniteNumber = (value: unknown) =>
  isFiniteNumber(value) ? value : undefined;

const getCenterAboveBaselineEm = (
  minY: number,
  maxY: number,
  unitsPerEm: number,
) => (minY + maxY) / (2 * unitsPerEm);

const getFontkitVisualCenterAboveBaselineEm = (
  font: PDFFont,
  text: string,
): number | undefined => {
  const embedder = (font as unknown as PdfFontWithEmbedder).embedder as
    | FontkitEmbedderLike
    | undefined;
  const fontkitFont = embedder?.font;
  if (typeof fontkitFont?.layout !== "function") return undefined;

  const scale = toFiniteNumber(embedder?.scale);
  const unitsPerEm =
    toFiniteNumber(fontkitFont.unitsPerEm) ??
    (scale !== undefined && scale > 0 ? 1000 / scale : undefined);
  if (!unitsPerEm || unitsPerEm <= 0) return undefined;

  let run: FontkitRunLike;
  try {
    run = fontkitFont.layout(text.length ? text : "Mg", embedder?.fontFeatures);
  } catch {
    return undefined;
  }
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < (run.glyphs?.length ?? 0); index++) {
    const glyph = run.glyphs?.[index];
    const bbox = glyph?.bbox;
    const glyphMinY = toFiniteNumber(bbox?.minY);
    const glyphMaxY = toFiniteNumber(bbox?.maxY);
    if (glyphMinY === undefined || glyphMaxY === undefined) continue;

    const yOffset = toFiniteNumber(run.positions?.[index]?.yOffset) ?? 0;
    minY = Math.min(minY, glyphMinY + yOffset);
    maxY = Math.max(maxY, glyphMaxY + yOffset);
  }

  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || minY >= maxY) {
    const ascent = toFiniteNumber(fontkitFont.ascent);
    const descent = toFiniteNumber(fontkitFont.descent);
    if (ascent !== undefined && descent !== undefined && descent < ascent) {
      minY = descent;
      maxY = ascent;
    } else {
      const bboxMinY = toFiniteNumber(fontkitFont.bbox?.minY);
      const bboxMaxY = toFiniteNumber(fontkitFont.bbox?.maxY);
      if (
        bboxMinY === undefined ||
        bboxMaxY === undefined ||
        bboxMinY >= bboxMaxY
      ) {
        return undefined;
      }
      minY = bboxMinY;
      maxY = bboxMaxY;
    }
  }

  return getCenterAboveBaselineEm(minY, maxY, unitsPerEm);
};

const getStandardFontVisualCenterAboveBaselineEm = (
  font: PDFFont,
): number | undefined => {
  const embedder = (font as unknown as PdfFontWithEmbedder).embedder as
    | StandardFontEmbedderLike
    | undefined;
  const standardFont = embedder?.font;
  if (!standardFont) return undefined;

  const fontBBox = standardFont.FontBBox;
  const bboxMaxY = Array.isArray(fontBBox)
    ? toFiniteNumber(fontBBox[3])
    : undefined;
  const maxY =
    toFiniteNumber(standardFont.CapHeight) ??
    toFiniteNumber(standardFont.Ascender) ??
    bboxMaxY;
  if (maxY === undefined || maxY <= 0) return undefined;

  return getCenterAboveBaselineEm(0, maxY, 1000);
};

export const getPdfTextVisualCenterAboveBaselineEm = (
  font: PDFFont,
  text: string,
): number => {
  return (
    getFontkitVisualCenterAboveBaselineEm(font, text) ??
    getStandardFontVisualCenterAboveBaselineEm(font) ??
    DEFAULT_FORM_TEXT_VISUAL_CENTER_ABOVE_BASELINE_EM
  );
};
