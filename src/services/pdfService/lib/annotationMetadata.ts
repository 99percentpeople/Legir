import { PDFDict, PDFHexString, PDFName } from "@cantoo/pdf-lib";

import { decodePdfString } from "./pdf-objects";

const LEGIR_ANNOTATION_METADATA_KEY = PDFName.of("Legir");
const APP_HIGHLIGHTED_TEXT_KEY = PDFName.of("HighlightedText");

export const setAppHighlightedText = (
  pdfDict: PDFDict,
  highlightedText: string | undefined,
) => {
  const normalized = highlightedText?.trim();
  if (!normalized) return;

  const meta = pdfDict.context.obj({
    HighlightedText: PDFHexString.fromText(normalized),
  });
  pdfDict.set(LEGIR_ANNOTATION_METADATA_KEY, meta);
};

export const getAppHighlightedText = (pdfDict: PDFDict) => {
  const meta = pdfDict.lookup(LEGIR_ANNOTATION_METADATA_KEY);
  if (!(meta instanceof PDFDict)) return undefined;

  return decodePdfString(meta.lookup(APP_HIGHLIGHTED_TEXT_KEY));
};
