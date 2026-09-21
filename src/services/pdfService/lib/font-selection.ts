import { isSerifFamily } from "./text";
import type { PDFFont, PDFForm } from "@cantoo/pdf-lib";
import { FieldType, type FormField } from "@/types";

// Font objects belong to one PDFDocument. Weak keys do not keep closed documents
// alive, and coverage checks must not mutate a font's subset by encoding probes.
const fontCharacterSets = new WeakMap<PDFFont, Set<number>>();

export const canFontEncodeText = (font: PDFFont, text: string): boolean => {
  let characterSet = fontCharacterSets.get(font);
  if (!characterSet) {
    characterSet = new Set(font.getCharacterSet());
    fontCharacterSets.set(font, characterSet);
  }
  for (const char of text) {
    // These are handled by the text layout layer, not drawn as glyphs.
    if (char === "\n" || char === "\r" || char === "\t") continue;
    if (!characterSet.has(char.codePointAt(0)!)) return false;
  }
  return true;
};

export const pickCjkFontFromMap = (
  fontMap: Map<string, PDFFont> | undefined,
  baseFontFamily?: string,
) => {
  if (!fontMap) return undefined;
  return isSerifFamily(baseFontFamily)
    ? fontMap.get("CustomSerif") || fontMap.get("Custom")
    : fontMap.get("CustomSans") || fontMap.get("Custom");
};

export const getControlAppearanceTexts = (field: FormField): string[] => [
  field.value ?? "",
  ...(field.type === FieldType.DROPDOWN && field.isMultiSelect
    ? (field.options ?? [])
    : []),
];

/** The same font decision for imported fields and newly created controls. */
export const pickControlValueFont = (
  field: FormField,
  form: Pick<PDFForm, "getDefaultFont">,
  fontMap?: Map<string, PDFFont>,
): PDFFont => {
  const selected =
    (field.style?.fontFamily
      ? fontMap?.get(field.style.fontFamily)
      : undefined) ??
    fontMap?.get("Helvetica") ??
    form.getDefaultFont();
  const texts = getControlAppearanceTexts(field);
  if (texts.every((text) => canFontEncodeText(selected, text))) return selected;

  const candidates = [
    pickCjkFontFromMap(fontMap, field.style?.fontFamily),
    fontMap?.get(
      isSerifFamily(field.style?.fontFamily)
        ? "Source Han Serif SC"
        : "Noto Sans SC",
    ),
  ];
  return (
    candidates.find(
      (font) => font && texts.every((text) => canFontEncodeText(font, text)),
    ) ?? selected
  );
};
