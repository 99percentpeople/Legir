import { FieldType, type FormField } from "@legir/pdf-model";
import type { PDFForm, PDFFont } from "@legir/pdfium/authoring";
import type {
  IControlExporter,
  ControlExportOptions,
  ViewportLike,
} from "../types.js";
import { getCommonControlExportOpts } from "../lib/control-export.js";
import { getOrCreateExportField } from "../lib/form-export-context.js";
import {
  applyFieldMetadata,
  applyFieldWidgetStyle,
} from "../lib/button-field.js";

/** Creates an unsigned /FT /Sig field. Signing requires a separate certificate-backed service. */
export class SignatureControlExporter implements IControlExporter {
  shouldExport(field: FormField) {
    return field.type === FieldType.SIGNATURE;
  }
  save(
    form: PDFForm,
    field: FormField,
    _fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
    options?: ControlExportOptions,
  ) {
    const signature = getOrCreateExportField(
      field.name,
      () => form.getSignature(field.name),
      () => form.createSignature(field.name),
      options?.context,
    );
    if (signature.getSignatureInfo())
      throw new Error("Cannot replace a populated signature field");
    const page = form.doc.getPage(field.pageIndex);
    signature.addToPage(
      page,
      getCommonControlExportOpts(field, page, viewport),
    );
    applyFieldMetadata(signature, field);
    const widget = signature.acroField.getWidgets().at(-1)!;
    applyFieldWidgetStyle(widget, field, signature, viewport);
    signature.updateWidgetAppearance(widget);
    // Deliberately no /V, bitmap stamping, fake signing, or signature certificate assertion.
  }
}
