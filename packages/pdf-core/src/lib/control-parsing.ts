import { DEFAULT_FIELD_STYLE } from "@legir/pdf-model/constants";
import type { FieldStyle, HorizontalAlignment } from "@legir/pdf-model";
import type { ParserContext, PdfJsAnnotation } from "../types.js";
import {
  fromPdfTextAlignment,
  type PDFDocument,
} from "@legir/pdfium/authoring";
import { normalizePdfColorToRgb255, rgbArrayToHex } from "./colors.js";
import {
  getFieldPropertiesFromPdfLib,
  parseDefaultAppearance,
} from "./appearance.js";

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
  systemFontFamilies?: string[],
): { style: FieldStyle; horizontalAlignment: HorizontalAlignment } => {
  let horizontalAlignment: HorizontalAlignment | undefined;
  const importedStyle: FieldStyle = { ...DEFAULT_FIELD_STYLE };

  if (annotation.color) {
    const rgb = normalizePdfColorToRgb255(annotation.color);
    const hex = rgb ? rgbArrayToHex(rgb) : undefined;
    if (hex) importedStyle.borderColor = hex;
  }

  if (annotation.backgroundColor) {
    const rgb = normalizePdfColorToRgb255(annotation.backgroundColor);
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
      horizontalAlignment = fromPdfTextAlignment(libProps.q);
    }
  }

  const finalDa = da || globalDA;

  if (finalDa) {
    const parsed = parseDefaultAppearance(finalDa, fontMap, systemFontFamilies);
    importedStyle.fontFamily = parsed.fontFamily;
    importedStyle.fontSize = parsed.fontSize;
    importedStyle.textColor = parsed.textColor;
  }

  return {
    style: importedStyle,
    horizontalAlignment:
      horizontalAlignment ??
      fromPdfTextAlignment(annotation.textAlignment) ??
      "left",
  };
};
