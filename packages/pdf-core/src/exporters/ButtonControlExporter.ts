import { FieldType, type FormField } from "@legir/pdf-model";
import type { PDFForm, PDFFont } from "@legir/pdfium/authoring";
import type {
  IControlExporter,
  ControlExportOptions,
  ViewportLike,
} from "../types.js";
import { getCommonControlExportOpts } from "../lib/control-export.js";
import { pickControlValueFont } from "../lib/font-selection.js";
import { getOrCreateExportField } from "../lib/form-export-context.js";
import { updateButtonWidget } from "../lib/button-field.js";

export class ButtonControlExporter implements IControlExporter {
  shouldExport(field: FormField) {
    return field.type === FieldType.BUTTON;
  }
  async save(
    form: PDFForm,
    field: FormField,
    fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
    options?: ControlExportOptions,
  ) {
    const button = getOrCreateExportField(
      field.name,
      () => form.getButton(field.name),
      () => form.createButton(field.name),
      options?.context,
    );
    const page = form.doc.getPage(field.pageIndex);
    const font = pickControlValueFont(field, form, fontMap);
    button.addToPage(field.buttonCaption ?? "", page, {
      ...getCommonControlExportOpts(field, page, viewport),
      font,
    });
    const widget = button.acroField.getWidgets().at(-1)!;
    await updateButtonWidget(
      button,
      widget,
      { ...field, sourceAppearanceKey: undefined },
      fontMap,
      viewport,
    );
  }
}
