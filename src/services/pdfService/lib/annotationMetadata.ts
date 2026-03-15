import { PDFDict, PDFHexString, PDFName } from "@cantoo/pdf-lib";

import { decodePdfString } from "./pdf-objects";

const FORMFORGE_ANNOTATION_METADATA_KEY = PDFName.of("FormForge");
const FORMFORGE_HIGHLIGHTED_TEXT_KEY = PDFName.of("HighlightedText");

export const setFormForgeHighlightedText = (
  pdfDict: PDFDict,
  highlightedText: string | undefined,
) => {
  const normalized = highlightedText?.trim();
  if (!normalized) return;

  const meta = pdfDict.context.obj({
    HighlightedText: PDFHexString.fromText(normalized),
  });
  pdfDict.set(FORMFORGE_ANNOTATION_METADATA_KEY, meta);
};

export const getFormForgeHighlightedText = (pdfDict: PDFDict) => {
  const meta = pdfDict.lookup(FORMFORGE_ANNOTATION_METADATA_KEY);
  if (!(meta instanceof PDFDict)) return undefined;

  return decodePdfString(meta.lookup(FORMFORGE_HIGHLIGHTED_TEXT_KEY));
};
