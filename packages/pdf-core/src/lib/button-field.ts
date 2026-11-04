import { decodeButtonImage } from "@legir/pdf-model/buttonImage";
import {
  PDFButton,
  PDFField,
  PDFHexString,
  PDFName,
  colorComponents,
  setFillingColor,
  type PDFWidgetAnnotation,
  type PDFFont,
} from "@legir/pdfium/authoring";
import type { FormField } from "@legir/pdf-model";
import { canPreserveFormAppearance } from "@legir/pdf-model/formAppearance";
import {
  getCommonControlExportOpts,
  applyWidgetExportRotation,
} from "./control-export.js";
import { pickControlValueFont } from "./font-selection.js";
import type { ViewportLike } from "../types.js";

export function applyFieldMetadata(native: PDFField, field: FormField) {
  if (native.getName() !== field.name) {
    const conflict = native.doc.getForm().getFieldMaybe(field.name);
    if (conflict && conflict.ref !== native.ref)
      throw new Error(`Duplicate PDF field name: ${field.name}`);
    // Keep an imported field's parent hierarchy. A changed full name must retain that prefix.
    const full = native.getName(),
      oldPartial = native.acroField.dict.lookup(PDFName.of("T"));
    const partial =
      oldPartial && "decodeText" in oldPartial
        ? (oldPartial as { decodeText(): string }).decodeText()
        : full;
    const prefix = full.slice(0, Math.max(0, full.length - partial.length));
    if (prefix && !field.name.startsWith(prefix))
      throw new Error(
        `Rename the leaf within the existing field group: ${prefix}`,
      );
    native.acroField.setPartialName(
      prefix ? field.name.slice(prefix.length) : field.name,
    );
    native.doc.getForm().invalidateNames();
  }
  if (field.toolTip)
    native.acroField.dict.set(
      PDFName.of("TU"),
      PDFHexString.fromText(field.toolTip),
    );
  else native.acroField.dict.delete(PDFName.of("TU"));
  if (field.readOnly) native.enableReadOnly();
  else native.disableReadOnly();
  if (field.required) native.enableRequired();
  else native.disableRequired();
}
export function applyFieldWidgetStyle(
  widget: PDFWidgetAnnotation,
  field: FormField,
  native: PDFField,
  viewport?: ViewportLike,
) {
  const page = native.doc.getPage(field.pageIndex);
  const opts = getCommonControlExportOpts(field, page, viewport);
  widget.setRectangle({
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
  });
  applyWidgetExportRotation(widget, page, field.rotationDeg);
  const mk = widget.getOrCreateAppearanceCharacteristics();
  if (opts.borderColor) mk.setBorderColor(colorComponents(opts.borderColor));
  else mk.dict.delete(PDFName.of("BC"));
  if (opts.backgroundColor)
    mk.setBackgroundColor(colorComponents(opts.backgroundColor));
  else mk.dict.delete(PDFName.of("BG"));
  const border = widget.getOrCreateBorderStyle();
  border.setWidth(opts.borderWidth);
  border.setStyle(
    PDFName.of(
      field.style?.borderStyle === "dashed"
        ? "D"
        : field.style?.borderStyle === "underline"
          ? "U"
          : "S",
    ),
  );
  if (opts.textColor)
    widget.setDefaultAppearance(setFillingColor(opts.textColor).toString());
}
export async function updateButtonWidget(
  button: PDFButton,
  widget: PDFWidgetAnnotation,
  field: FormField,
  fontMap?: Map<string, PDFFont>,
  viewport?: ViewportLike,
) {
  applyFieldMetadata(button, field);
  // Preserve foreign actions, icon resources and custom appearances on a no-op save or move.
  if (
    canPreserveFormAppearance(field) &&
    field.buttonImage === undefined &&
    widget.getAppearances().normal
  ) {
    button.doc.getForm().markFieldAsClean(button.ref);
    return;
  }
  applyFieldWidgetStyle(widget, field, button, viewport);
  if (field.buttonCaption !== undefined)
    button.setCaption(field.buttonCaption, widget);
  if (field.buttonLayout !== undefined)
    button.setLayout(field.buttonLayout, widget);
  if (field.buttonImageFit) button.setImageFit(field.buttonImageFit, widget);
  if (field.buttonImage !== undefined) {
    if (field.buttonImage === null) button.setImage(undefined, widget);
    else {
      // No URL fetching: template APIs must supply bytes/data, not an SSRF-capable URL.
      const decoded = decodeButtonImage(field.buttonImage);
      const image =
        decoded.mimeType === "image/png"
          ? await button.doc.embedPng(decoded.bytes)
          : await button.doc.embedJpg(decoded.bytes);
      button.setImage(image, widget);
    }
  }
  if (field.style?.fontSize !== undefined)
    button.setFontSize(field.style.fontSize);
  button.updateWidgetAppearance(
    widget,
    pickControlValueFont(field, button.doc.getForm(), fontMap),
  );
}
