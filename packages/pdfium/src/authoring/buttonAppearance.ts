// Copyright (c) 2026 Legir contributors. MIT; see ../../LICENSE.
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFStream,
} from "./objects.js";
import type { PDFOperator } from "./objects.js";
import type { PDFField, PDFWidgetAnnotation } from "./forms.js";
import type { PDFFont } from "./fonts.js";
import {
  componentsToColor,
  drawRectangle,
  layoutSinglelineText,
  op,
  rotateInPlace,
  setFillingColor,
  setStrokingColor,
  TextAlignment,
  rgb,
  type Color,
} from "./operators.js";

/** ISO 32000 /MK /TP: caption, icon, icon above/below/left/right, overlay. */
export type PDFButtonLayout = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type PDFButtonImageFit = {
  scaleMode: "contain" | "fill";
  alignment: [number, number];
  when: "always" | "bigger" | "smaller" | "never";
  fitBounds: boolean;
};
const key = PDFName.of;
const numbers = (dict: PDFDict, name: string) =>
  dict
    .lookupMaybe(key(name), PDFArray)
    ?.asArray()
    .map((v) => (v instanceof PDFNumber ? v.asNumber() : NaN));
export function getButtonIconBounds(icon: PDFStream) {
  const box = numbers(icon.dict, "BBox") ?? [0, 0, 1, 1];
  const m = numbers(icon.dict, "Matrix") ?? [1, 0, 0, 1, 0, 0];
  if (
    box.length !== 4 ||
    m.length !== 6 ||
    ![...box, ...m].every(Number.isFinite)
  )
    throw new Error("Invalid button icon geometry");
  const points = [
    [box[0], box[1]],
    [box[0], box[3]],
    [box[2], box[1]],
    [box[2], box[3]],
  ].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const x = Math.min(...points.map((p) => p[0])),
    y = Math.min(...points.map((p) => p[1]));
  const width = Math.max(...points.map((p) => p[0])) - x,
    height = Math.max(...points.map((p) => p[1])) - y;
  if (!(width > 0 && height > 0)) throw new Error("Empty button icon bounds");
  return { x, y, width, height };
}
export function readButtonLayout(widget: PDFWidgetAnnotation): PDFButtonLayout {
  const value =
    widget
      .getAppearanceCharacteristics()
      ?.dict.lookupMaybe(key("TP"), PDFNumber)
      ?.asNumber() ?? 0;
  return Number.isInteger(value) && value >= 0 && value <= 6
    ? (value as PDFButtonLayout)
    : 0;
}
export function readButtonImageFit(
  widget: PDFWidgetAnnotation,
): PDFButtonImageFit {
  const fit = widget
    .getAppearanceCharacteristics()
    ?.dict.lookupMaybe(key("IF"), PDFDict);
  const align = fit && numbers(fit, "A");
  const clamp = (v: number | undefined) =>
    Number.isFinite(v) ? Math.max(0, Math.min(1, v!)) : 0.5;
  const when = fit?.lookupMaybe(key("SW"), PDFName)?.decodeText();
  return {
    scaleMode:
      fit?.lookupMaybe(key("S"), PDFName) === key("A") ? "fill" : "contain",
    alignment: [clamp(align?.[0]), clamp(align?.[1])],
    when:
      when === "B"
        ? "bigger"
        : when === "S"
          ? "smaller"
          : when === "N"
            ? "never"
            : "always",
    fitBounds: fit?.lookup(key("FB")) === PDFBool.True,
  };
}
/** Generate a normal appearance without executing actions or touching /V. */
export function writeButtonAppearance(
  field: PDFField,
  widget: PDFWidgetAnnotation,
  font?: PDFFont,
  caption = "",
  layout: PDFButtonLayout = 0,
) {
  const r = widget.getRectangle(),
    mk = widget.getAppearanceCharacteristics();
  const rotation = mk?.getRotation() ?? 0;
  const width = rotation % 180 ? r.height : r.width;
  const height = rotation % 180 ? r.width : r.height;
  const border = Math.max(0, widget.getBorderStyle()?.getWidth() ?? 0);
  const pad = Math.min(border + 1, width / 2, height / 2);
  const inner = {
    x: pad,
    y: pad,
    width: Math.max(0, width - pad * 2),
    height: Math.max(0, height - pad * 2),
  };
  const icon = mk?.dict.lookup(key("I"));
  const fit = readButtonImageFit(widget);
  const da =
    widget.getDefaultAppearance() ??
    field.acroField.getDefaultAppearance() ??
    "";
  const sizeFrom = (s: string) => Number(/([\d.]+)\s+Tf/.exec(s)?.[1]);
  const requestedSize =
    sizeFrom(field.acroField.getDefaultAppearance() ?? "") ||
    sizeFrom(da) ||
    12;
  let textColor: Color = rgb(0, 0, 0);
  for (const match of da.matchAll(
    /((?:[-+]?(?:\d*\.)?\d+\s+){1,4})(rg|g|k)\b/g,
  )) {
    const values = match[1].trim().split(/\s+/).map(Number);
    if (values.length === (match[2] === "rg" ? 3 : match[2] === "k" ? 4 : 1))
      textColor = componentsToColor(values)!;
  }
  const borderStyle = widget.getBorderStyle()?.getStyle();
  const borderColor = componentsToColor(mk?.getBorderColor());
  const underline = borderStyle === key("U");
  const ops: PDFOperator[] = [
    ...rotateInPlace({ ...r, rotation }),
    ...drawRectangle({
      x: border / 2,
      y: border / 2,
      width: Math.max(0, width - border),
      height: Math.max(0, height - border),
      borderWidth: underline ? 0 : border,
      borderColor: underline ? undefined : borderColor,
      borderDashArray: borderStyle === key("D") ? [3, 3] : undefined,
      color: componentsToColor(mk?.getBackgroundColor()),
    }),
  ];
  if (underline && border > 0 && borderColor)
    ops.push(
      op("q"),
      setStrokingColor(borderColor),
      op("w", border),
      op("m", 0, border / 2),
      op("l", width, border / 2),
      op("S"),
      op("Q"),
    );
  const labelBox = { ...inner };
  let iconBox = { ...inner };
  const hasCaption = layout !== 1 && !!caption && !!font;
  if (hasCaption && layout >= 2 && layout <= 5) {
    if (layout === 2 || layout === 3) {
      const h = Math.min(inner.height * 0.4, requestedSize * 1.4 + 2);
      labelBox.height = h;
      iconBox.height = Math.max(0, inner.height - h - 2);
      if (layout === 2) iconBox.y += h + 2;
      else labelBox.y += inner.height - h;
    } else {
      const w = Math.min(
        inner.width * 0.6,
        font!.widthOfTextAtSize(caption, requestedSize) + 4,
      );
      labelBox.width = w;
      iconBox.width = Math.max(0, inner.width - w - 2);
      if (layout === 4) labelBox.x += inner.width - w;
      else iconBox.x += w + 2;
    }
  }
  const resources = field.doc.context.obj({});
  if (layout !== 0 && icon instanceof PDFStream) {
    if (fit.fitBounds && (layout === 1 || layout === 6 || !hasCaption))
      iconBox = { x: 0, y: 0, width, height };
    if (iconBox.width > 0 && iconBox.height > 0) {
      const b = getButtonIconBounds(icon);
      let sx = iconBox.width / b.width,
        sy = iconBox.height / b.height;
      if (fit.scaleMode === "contain") sx = sy = Math.min(sx, sy);
      if (fit.when === "never") sx = sy = 1;
      else if (fit.when === "bigger") {
        sx = Math.min(1, sx);
        sy = Math.min(1, sy);
      } else if (fit.when === "smaller") {
        sx = Math.max(1, sx);
        sy = Math.max(1, sy);
      }
      const x =
        iconBox.x +
        (iconBox.width - b.width * sx) * fit.alignment[0] -
        b.x * sx;
      const y =
        iconBox.y +
        (iconBox.height - b.height * sy) * fit.alignment[1] -
        b.y * sy;
      const iconRef =
        field.doc.context.getObjectRef(icon) ??
        field.doc.context.register(icon);
      resources.set(key("XObject"), field.doc.context.obj({ Icon: iconRef }));
      ops.push(
        op("q"),
        op("re", iconBox.x, iconBox.y, iconBox.width, iconBox.height),
        op("W"),
        op("n"),
        op("cm", sx, 0, 0, sy, x, y),
        op("Do", key("Icon")),
        op("Q"),
      );
    }
  }
  if (hasCaption && labelBox.width > 0 && labelBox.height > 0) {
    const size = Math.max(
      0.1,
      Math.min(
        requestedSize,
        labelBox.height / Math.max(0.001, font!.heightAtSize(1)),
        labelBox.width / Math.max(0.001, font!.widthOfTextAtSize(caption, 1)),
      ),
    );
    const text = layoutSinglelineText(caption, {
      font: font!,
      fontSize: size,
      bounds: labelBox,
      alignment: TextAlignment.Center,
    }).line;
    resources.set(
      key("Font"),
      field.doc.context.obj({ [font!.name]: font!.ref }),
    );
    ops.push(
      op("q"),
      op("re", labelBox.x, labelBox.y, labelBox.width, labelBox.height),
      op("W"),
      op("n"),
      setFillingColor(textColor),
      op("BT"),
      op("Tf", key(font!.name), size),
      op("Tm", 1, 0, 0, 1, text.x, text.y),
      op("Tj", text.encoded),
      op("ET"),
      op("Q"),
    );
  }
  const appearance = field.doc.context.formXObject(ops, {
    BBox: [0, 0, r.width, r.height],
    Resources: resources,
  });
  widget.setNormalAppearance(field.doc.context.register(appearance));
}
