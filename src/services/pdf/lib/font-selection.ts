import { isSerifFamily } from "./text";

export const pickCjkFontFromMap = (
  fontMap: Map<string, any> | undefined,
  baseFontFamily?: string,
) => {
  if (!fontMap) return undefined;
  return isSerifFamily(baseFontFamily)
    ? fontMap.get("CustomSerif") || fontMap.get("Custom")
    : fontMap.get("CustomSans") || fontMap.get("Custom");
};
