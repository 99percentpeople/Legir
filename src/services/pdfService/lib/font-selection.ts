import { isSerifFamily } from "./text";
import type { PDFFont } from "@cantoo/pdf-lib";

export const pickCjkFontFromMap = (
  fontMap: Map<string, PDFFont> | undefined,
  baseFontFamily?: string,
) => {
  if (!fontMap) return undefined;
  return isSerifFamily(baseFontFamily)
    ? fontMap.get("CustomSerif") || fontMap.get("Custom")
    : fontMap.get("CustomSans") || fontMap.get("Custom");
};
