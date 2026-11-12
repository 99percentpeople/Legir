import type { PDFFont, ShapingFont } from "@legir/pdfium/authoring";
import { DEFAULT_FORM_TEXT_VISUAL_CENTER_ABOVE_BASELINE_EM } from "@legir/pdf-model/fonts";

type ShapingEmbedderLike = {
  font?: Partial<ShapingFont>;
  scale?: unknown;
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
  embedder?: ShapingEmbedderLike | StandardFontEmbedderLike;
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

const getShapingVisualCenterAboveBaselineEm = (
  font: PDFFont,
  text: string,
): number | undefined => {
  const embedder = (font as unknown as PdfFontWithEmbedder).embedder as
    ShapingEmbedderLike | undefined;
  const shapingFont = embedder?.font;
  if (typeof shapingFont?.layout !== "function") return undefined;

  const scale = toFiniteNumber(embedder?.scale);
  const unitsPerEm =
    toFiniteNumber(shapingFont.unitsPerEm) ??
    (scale !== undefined && scale > 0 ? 1000 / scale : undefined);
  if (!unitsPerEm || unitsPerEm <= 0) return undefined;

  let run: ReturnType<ShapingFont["layout"]>;
  try {
    run = shapingFont.layout(text.length ? text : "Mg");
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
    const ascent = toFiniteNumber(shapingFont.ascent);
    const descent = toFiniteNumber(shapingFont.descent);
    if (ascent !== undefined && descent !== undefined && descent < ascent) {
      minY = descent;
      maxY = ascent;
    } else {
      const bboxMinY = toFiniteNumber(shapingFont.bbox?.minY);
      const bboxMaxY = toFiniteNumber(shapingFont.bbox?.maxY);
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
    StandardFontEmbedderLike | undefined;
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
    getShapingVisualCenterAboveBaselineEm(font, text) ??
    getStandardFontVisualCenterAboveBaselineEm(font) ??
    DEFAULT_FORM_TEXT_VISUAL_CENTER_ABOVE_BASELINE_EM
  );
};
