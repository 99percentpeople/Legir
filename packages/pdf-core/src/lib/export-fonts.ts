import type { PDFDocument, PDFFont, FontEngine } from "@legir/pdfium/authoring";
import { FieldType, type Annotation, type FormField } from "@legir/pdf-model";
import { hasSystemFontProvider, getPdfHost } from "../host.js";
import {
  loadAndEmbedExportFonts,
  loadAndEmbedSelectedSystemFonts,
  type ExportFontConfig,
} from "./built-in-fonts.js";
import {
  canFontEncodeText,
  getControlAppearanceTexts,
} from "./font-selection.js";
import { isExplicitCjkFontSelection, isSerifFamily } from "./text.js";

/** Call with only the controls whose appearances will actually be exported. */
export const prepareExportFonts = async (args: {
  pdfDoc: PDFDocument;
  fontMap: Map<string, PDFFont>;
  fields: FormField[];
  annotations: Annotation[];
  customFont?: { bytes?: Uint8Array; name?: string };
}) => {
  const { pdfDoc, fontMap, customFont } = args;
  const requests: { family?: string; texts: string[] }[] = [];
  for (const field of args.fields) {
    if (
      field.type !== FieldType.TEXT &&
      field.type !== FieldType.DROPDOWN &&
      field.type !== FieldType.BUTTON
    )
      continue;
    requests.push({
      family: field.style?.fontFamily,
      texts: getControlAppearanceTexts(field),
    });
  }
  for (const annotation of args.annotations) {
    if (annotation.type !== "freetext") continue;
    requests.push({
      family: annotation.fontFamily,
      texts: [annotation.text ?? ""],
    });
  }
  // Tooltips, authors, comments and choice metadata are PDF strings, not glyphs.
  const families = new Set(
    requests
      .map(({ family }) => family)
      .filter((family): family is string => !!family),
  );
  const needsCustomFont =
    !!customFont?.bytes?.length &&
    ["Custom", "CustomSans", "CustomSerif"].some((family) =>
      families.has(family),
    );
  const systemFamilies = hasSystemFontProvider()
    ? [...families].filter(
        (family) => !fontMap.has(family) && !isExplicitCjkFontSelection(family),
      )
    : [];

  let fontEngine: FontEngine | undefined;
  const getFontEngine = async () => {
    if (fontEngine) return fontEngine;
    const load = getPdfHost().loadFontEngine;
    if (!load)
      throw new Error(
        "Custom font export requires configurePdfHost({ loadFontEngine })",
      );
    return (fontEngine = await load());
  };

  // Resolve the selected fonts before deciding whether a CJK fallback is needed.
  if (needsCustomFont && customFont?.bytes) {
    await loadAndEmbedExportFonts({
      pdfDoc,
      fontMap,
      fontEngine: await getFontEngine(),
      customFont: { bytes: customFont.bytes, name: customFont.name },
      includeFontIds: new Set(),
      subset: true,
    });
  }
  if (systemFamilies.length > 0) {
    await loadAndEmbedSelectedSystemFonts({
      pdfDoc,
      fontMap,
      fontEngine: await getFontEngine(),
      families: systemFamilies,
      subset: true,
    });
  }

  const includeFontIds = new Set<ExportFontConfig["id"]>();
  for (const { family, texts } of requests) {
    const selected =
      (family ? fontMap.get(family) : undefined) ?? fontMap.get("Helvetica");
    const explicitFontMissing =
      isExplicitCjkFontSelection(family) && !fontMap.has(family!);
    if (
      !explicitFontMissing &&
      selected &&
      texts.every((text) => canFontEncodeText(selected, text))
    )
      continue;
    includeFontIds.add(isSerifFamily(family) ? "cjk_serif" : "cjk_sans");
  }
  if (includeFontIds.size > 0) {
    await loadAndEmbedExportFonts({
      pdfDoc,
      fontMap,
      fontEngine: await getFontEngine(),
      includeFontIds,
      subset: true,
    });
  }
};
