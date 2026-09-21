import type { PDFDocument, PDFFont } from "@cantoo/pdf-lib";
import { FieldType, type Annotation, type FormField } from "@/types";
import { isDesktopApp } from "@/services/platform";
import {
  loadAndEmbedExportFonts,
  loadAndEmbedSelectedSystemFonts,
  type ExportFontConfig,
} from "./built-in-fonts";
import { canFontEncodeText, getControlAppearanceTexts } from "./font-selection";
import { isExplicitCjkFontSelection, isSerifFamily } from "./text";

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
      !(field.type === FieldType.SIGNATURE && !field.signatureData)
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
  const systemFamilies = isDesktopApp()
    ? [...families].filter(
        (family) => !fontMap.has(family) && !isExplicitCjkFontSelection(family),
      )
    : [];

  let fontkit: Parameters<PDFDocument["registerFontkit"]>[0] | undefined;
  const getFontkit = async () =>
    (fontkit ??= (await import("pdf-fontkit")).default);

  // Resolve the selected fonts before deciding whether a CJK fallback is needed.
  if (needsCustomFont && customFont?.bytes) {
    await loadAndEmbedExportFonts({
      pdfDoc,
      fontMap,
      fontkit: await getFontkit(),
      customFont: { bytes: customFont.bytes, name: customFont.name },
      includeFontIds: new Set(),
      subset: true,
    });
  }
  if (systemFamilies.length > 0) {
    await loadAndEmbedSelectedSystemFonts({
      pdfDoc,
      fontMap,
      fontkit: await getFontkit(),
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
      fontkit: await getFontkit(),
      includeFontIds,
      subset: true,
    });
  }
};
