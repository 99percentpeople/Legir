import { DEFAULT_FIELD_STYLE } from "@/constants";
import type { FieldStyle } from "@/types";
import type { ParserContext, PdfJsAnnotation } from "../types";
import type { PDFDocument } from "pdf-lib";
import { rgbArrayToHex } from "./colors";
import {
  getFieldPropertiesFromPdfLib,
  parseDefaultAppearance,
} from "./appearance";

const normalizePdfJsColorToRgb255 = (
  color: number[] | Uint8ClampedArray | null | undefined,
) => {
  if (!color || color.length < 3) return undefined;
  const r = color[0];
  const g = color[1];
  const b = color[2];
  const isNormalized01 =
    r >= 0 && r <= 1 && g >= 0 && g <= 1 && b >= 0 && b <= 1;
  if (isNormalized01) return [r * 255, g * 255, b * 255];
  return [r, g, b];
};

export const getStyleParsingResources = (context: ParserContext) => {
  return {
    fontMap: context.fontMap ?? new Map<string, string>(),
    globalDA: context.globalDA,
  };
};

export const parseFieldStyle = (
  annotation: PdfJsAnnotation,
  pdfDoc: PDFDocument | undefined,
  fontMap: Map<string, string>,
  globalDA: string | undefined,
): { style: FieldStyle; alignment: "left" | "center" | "right" } => {
  let alignment: "left" | "center" | "right" = "left";
  const importedStyle: FieldStyle = { ...DEFAULT_FIELD_STYLE };

  if (annotation.color) {
    const rgb = normalizePdfJsColorToRgb255(annotation.color);
    const hex = rgb ? rgbArrayToHex(rgb) : undefined;
    if (hex) importedStyle.borderColor = hex;
  }

  if (annotation.backgroundColor) {
    const rgb = normalizePdfJsColorToRgb255(annotation.backgroundColor);
    const hex = rgb ? rgbArrayToHex(rgb) : undefined;
    if (hex) {
      importedStyle.backgroundColor = hex;
      importedStyle.isTransparent = false;
    }
  } else {
    importedStyle.isTransparent = true;
  }

  // Border import rules:
  // - If the PDF provides no border info at all, treat it as "no border" (width = 0)
  //   to avoid falling back to DEFAULT_FIELD_STYLE.borderWidth = 1.
  // - If the PDF explicitly provides a border width, always respect it (including 0).
  // - If the PDF provides only a border style (e.g. via appearance stream heuristics)
  //   but no explicit width, default the width to 1.
  const hasBorderWidth = typeof annotation.borderStyle?.width === "number";
  const hasBorderStyle = typeof annotation.borderStyle?.style === "string";

  if (!hasBorderWidth && !hasBorderStyle) {
    importedStyle.borderWidth = 0;
  }

  if (hasBorderWidth) {
    importedStyle.borderWidth = annotation.borderStyle!.width;
  }

  if (hasBorderStyle) {
    importedStyle.borderStyle = annotation.borderStyle!.style;
    if (!hasBorderWidth) {
      importedStyle.borderWidth = 1;
    }
  }

  let da = annotation.defaultAppearance || annotation.DA;
  if (pdfDoc && annotation.fieldName) {
    const libProps = getFieldPropertiesFromPdfLib(pdfDoc, annotation.fieldName);
    if (libProps) {
      if (libProps.da) {
        da = libProps.da;
      }
      if (libProps.q !== undefined) {
        if (libProps.q === 1) alignment = "center";
        else if (libProps.q === 2) alignment = "right";
      }
    }
  }

  const finalDa = da || globalDA;

  if (finalDa) {
    const parsed = parseDefaultAppearance(finalDa, fontMap);
    importedStyle.fontFamily = parsed.fontFamily;
    importedStyle.fontSize = parsed.fontSize;
    importedStyle.textColor = parsed.textColor;
  }

  if (alignment === "left" && typeof annotation.textAlignment === "number") {
    if (annotation.textAlignment === 1) alignment = "center";
    else if (annotation.textAlignment === 2) alignment = "right";
  }

  return { style: importedStyle, alignment };
};
