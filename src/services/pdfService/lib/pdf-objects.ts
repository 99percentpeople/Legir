import { PDFHexString, PDFString } from "@cantoo/pdf-lib";

export const decodePdfString = (value: unknown): string | undefined => {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    return value.decodeText();
  }
  return undefined;
};
