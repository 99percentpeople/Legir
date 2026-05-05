import {
  cmyk,
  componentsToColor,
  drawTextField,
  grayscale,
  layoutCombedText,
  layoutMultilineText,
  layoutSinglelineText,
  reduceRotation,
  rgb,
  rotateInPlace,
  setFillingColor,
  setFontAndSize,
  type AppearanceProviderFor,
  type Color,
  type PDFFont,
  type PDFHexString,
  type PDFTextField,
  type PDFWidgetAnnotation,
} from "@cantoo/pdf-lib";
import { getPdfTextVisualCenterAboveBaselineEm } from "./text-field-metrics";

const tfRegex =
  /\/([^\0\t\n\f\r ]+)[\0\t\n\f\r ]+(\d*\.\d+|\d+)[\0\t\n\f\r ]+Tf/g;
const colorRegex =
  /(\d*\.\d+|\d+)[\0\t\n\f\r ]*(\d*\.\d+|\d+)?[\0\t\n\f\r ]*(\d*\.\d+|\d+)?[\0\t\n\f\r ]*(\d*\.\d+|\d+)?[\0\t\n\f\r ]+(g|rg|k)/g;
type DefaultAppearanceTarget = {
  getDefaultAppearance: () => string | undefined;
  setDefaultAppearance: (appearance: string) => void;
};

const getLastRegexMatch = (value: string, regex: RegExp) => {
  regex.lastIndex = 0;
  let last: RegExpExecArray | null = null;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(value))) {
    last = match;
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  regex.lastIndex = 0;
  return last;
};

const getDefaultFontSize = (field: DefaultAppearanceTarget) => {
  const da = field.getDefaultAppearance() ?? "";
  const defaultFontSize = Number(getLastRegexMatch(da, tfRegex)?.[2]);
  return Number.isFinite(defaultFontSize) ? defaultFontSize : undefined;
};

const getDefaultColor = (field: DefaultAppearanceTarget): Color | undefined => {
  const da = field.getDefaultAppearance() ?? "";
  const [, c1, c2, c3, c4, colorSpace] =
    getLastRegexMatch(da, colorRegex) ?? [];

  if (colorSpace === "g" && c1) return grayscale(Number(c1));
  if (colorSpace === "rg" && c1 && c2 && c3) {
    return rgb(Number(c1), Number(c2), Number(c3));
  }
  if (colorSpace === "k" && c1 && c2 && c3 && c4) {
    return cmyk(Number(c1), Number(c2), Number(c3), Number(c4));
  }

  return undefined;
};

const updateDefaultAppearance = (
  field: DefaultAppearanceTarget,
  color: Color,
  font: PDFFont,
  fontSize = 0,
) => {
  field.setDefaultAppearance(
    [
      setFillingColor(color).toString(),
      setFontAndSize(font.name ?? "dummy__noop", fontSize).toString(),
    ].join("\n"),
  );
};

const getCenteredBaselineY = (
  bounds: { y: number; height: number },
  fontSize: number,
  centerAboveBaselineEm: number,
) => bounds.y + bounds.height / 2 - centerAboveBaselineEm * fontSize;

const liftSingleLineBaseline = <T extends { text?: string; y: number }>(
  line: T,
  fontSize: number,
  bounds: { y: number; height: number },
  font: PDFFont,
): T => ({
  ...line,
  y: getCenteredBaselineY(
    bounds,
    fontSize,
    getPdfTextVisualCenterAboveBaselineEm(font, line.text ?? ""),
  ),
});

const liftMultilineBaselines = <T extends { text?: string; y: number }>(
  lines: T[],
  fontSize: number,
  lineHeight: number,
  font: PDFFont,
): T[] => {
  return lines.map((line) => {
    const lift =
      lineHeight / 2 -
      getPdfTextVisualCenterAboveBaselineEm(font, line.text ?? "") * fontSize;
    return { ...line, y: line.y + lift };
  });
};

export const flattenTextFieldAppearanceProvider: AppearanceProviderFor<
  PDFTextField
> = (textField, widget: PDFWidgetAnnotation, font) => {
  const widgetColor = getDefaultColor(widget);
  const fieldColor = getDefaultColor(textField.acroField);
  const widgetFontSize = getDefaultFontSize(widget);
  const fieldFontSize = getDefaultFontSize(textField.acroField);

  const rectangle = widget.getRectangle();
  const ap = widget.getAppearanceCharacteristics();
  const bs = widget.getBorderStyle();
  const text = textField.getText() ?? "";

  const borderWidth = bs?.getWidth() ?? 0;
  const rotation = reduceRotation(ap?.getRotation());
  const width =
    rotation === 90 || rotation === 270 ? rectangle.height : rectangle.width;
  const height =
    rotation === 90 || rotation === 270 ? rectangle.width : rectangle.height;
  const rotate = rotateInPlace({ ...rectangle, rotation });

  const black = rgb(0, 0, 0);
  const borderColor = componentsToColor(ap?.getBorderColor());
  const normalBackgroundColor = componentsToColor(ap?.getBackgroundColor());
  const textColor = widgetColor ?? fieldColor ?? black;

  let textLines: { encoded: PDFHexString; x: number; y: number }[];
  let fontSize: number;

  const padding = textField.isCombed() ? 0 : 1;
  const bounds = {
    x: borderWidth + padding,
    y: borderWidth + padding,
    width: width - (borderWidth + padding) * 2,
    height: height - (borderWidth + padding) * 2,
  };

  if (textField.isMultiline()) {
    const inputFontSize = widgetFontSize ?? fieldFontSize;
    const layout = layoutMultilineText(text, {
      alignment: textField.getAlignment(),
      fontSize: inputFontSize,
      font,
      bounds,
    });
    textLines = liftMultilineBaselines(
      layout.lines,
      layout.fontSize,
      layout.lineHeight,
      font,
    );
    fontSize = layout.fontSize;
  } else if (textField.isCombed()) {
    const inputFontSize = widgetFontSize ?? fieldFontSize;
    const layout = layoutCombedText(text, {
      fontSize: inputFontSize,
      font,
      bounds,
      cellCount: textField.getMaxLength() ?? 0,
    });
    textLines = layout.cells.map((cell) =>
      liftSingleLineBaseline(cell, layout.fontSize, bounds, font),
    );
    fontSize = layout.fontSize;
  } else {
    const inputFontSize = widgetFontSize ?? fieldFontSize;
    const layout = layoutSinglelineText(text, {
      alignment: textField.getAlignment(),
      fontSize: inputFontSize,
      font,
      bounds,
    });
    textLines = [
      liftSingleLineBaseline(layout.line, layout.fontSize, bounds, font),
    ];
    fontSize = layout.fontSize;
  }

  if (widgetColor || widgetFontSize !== undefined) {
    updateDefaultAppearance(widget, textColor, font, fontSize);
  } else {
    updateDefaultAppearance(textField.acroField, textColor, font, fontSize);
  }

  return [
    ...rotate,
    ...drawTextField({
      x: borderWidth / 2,
      y: borderWidth / 2,
      width: width - borderWidth,
      height: height - borderWidth,
      borderWidth,
      borderColor,
      textColor,
      font: font.name,
      fontSize,
      color: normalBackgroundColor,
      textLines,
      padding,
    }),
  ];
};
