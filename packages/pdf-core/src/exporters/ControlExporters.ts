import { isListBoxField } from "@legir/pdf-model/choiceFields";
import {
  PDFForm,
  PDFName,
  PDFString,
  TextAlignment,
  type PDFFont,
} from "@legir/pdfium/authoring";
import { FormField, FieldType } from "@legir/pdf-model";
import { PDF_CUSTOM_KEYS } from "@legir/pdf-model/constants";
import {
  IControlExporter,
  type ControlExportOptions,
  ViewportLike,
} from "../types.js";
import { pickControlValueFont } from "../lib/font-selection.js";
import {
  applyWidgetExportRotation,
  getCommonControlExportOpts,
} from "../lib/control-export.js";
import { flattenTextFieldAppearanceProvider } from "../lib/text-field-appearance.js";
import {
  getOrCreateExportField,
  updateExportFieldAppearance,
} from "../lib/form-export-context.js";

export class TextControlExporter implements IControlExporter {
  shouldExport(field: FormField): boolean {
    return field.type === FieldType.TEXT;
  }

  save(
    form: PDFForm,
    field: FormField,
    fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
    options?: ControlExportOptions,
  ): void {
    const page = form.doc.getPage(field.pageIndex);
    const commonOpts = getCommonControlExportOpts(field, page, viewport);

    const fieldFont = pickControlValueFont(field, form, fontMap);

    const tf = getOrCreateExportField(
      field.name,
      () => form.getTextField(field.name),
      () => form.createTextField(field.name),
      options?.context,
    );

    tf.addToPage(page, { ...commonOpts, font: fieldFont });
    applyWidgetExportRotation(
      tf.acroField.getWidgets().at(-1),
      page,
      field.rotationDeg,
    );
    const appearanceFont = fieldFont ?? form.getDefaultFont();

    if (field.value) {
      tf.setText(field.value);
    }
    if (field.toolTip) {
      tf.acroField.dict.set(PDFName.of("TU"), PDFString.of(field.toolTip));
    } else {
      tf.acroField.dict.delete(PDFName.of("TU"));
    }

    if (field.placeholder) {
      tf.acroField.dict.set(
        PDFName.of(PDF_CUSTOM_KEYS.placeholder),
        PDFString.of(field.placeholder),
      );
    } else {
      tf.acroField.dict.delete(PDFName.of(PDF_CUSTOM_KEYS.placeholder));
    }

    if (field.style?.fontSize) tf.setFontSize(field.style.fontSize);

    if (field.alignment === "center") tf.setAlignment(TextAlignment.Center);
    else if (field.alignment === "right") tf.setAlignment(TextAlignment.Right);

    if (field.multiline) tf.enableMultiline();

    updateExportFieldAppearance(
      tf,
      () => {
        try {
          if (options?.flattenAppearance) {
            tf.updateAppearances(
              appearanceFont,
              flattenTextFieldAppearanceProvider,
            );
          } else {
            tf.updateAppearances(appearanceFont);
          }
        } catch (e) {
          console.warn("Failed to update text field appearances", e);
          return false;
        }
      },
      options?.context,
    );
  }
}

export class CheckboxControlExporter implements IControlExporter {
  shouldExport(field: FormField): boolean {
    return field.type === FieldType.CHECKBOX;
  }

  save(
    form: PDFForm,
    field: FormField,
    fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
    options?: ControlExportOptions,
  ): void {
    const page = form.doc.getPage(field.pageIndex);
    const commonOpts = getCommonControlExportOpts(field, page, viewport);

    const cb = getOrCreateExportField(
      field.name,
      () => form.getCheckBox(field.name),
      () => form.createCheckBox(field.name),
      options?.context,
    );

    cb.addToPage(page, commonOpts);
    applyWidgetExportRotation(
      cb.acroField.getWidgets().at(-1),
      page,
      field.rotationDeg,
    );
    if (field.isChecked) cb.check();
    else cb.uncheck();

    if (field.toolTip) {
      cb.acroField.dict.set(PDFName.of("TU"), PDFString.of(field.toolTip));
    }

    updateExportFieldAppearance(
      cb,
      () => {
        try {
          cb.updateAppearances();
        } catch (e) {
          console.warn("Failed to update checkbox appearances", e);
          return false;
        }
      },
      options?.context,
    );
  }
}

export class DropdownControlExporter implements IControlExporter {
  shouldExport(field: FormField): boolean {
    return field.type === FieldType.DROPDOWN;
  }

  save(
    form: PDFForm,
    field: FormField,
    fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
    options?: ControlExportOptions,
  ): void {
    const page = form.doc.getPage(field.pageIndex);
    const commonOpts = getCommonControlExportOpts(field, page, viewport);

    const fieldFont = pickControlValueFont(field, form, fontMap);

    if (isListBoxField(field)) {
      const ol = getOrCreateExportField(
        field.name,
        () => form.getOptionList(field.name),
        () => form.createOptionList(field.name),
        options?.context,
      );

      ol.addToPage(page, { ...commonOpts, font: fieldFont });
      applyWidgetExportRotation(
        ol.acroField.getWidgets().at(-1),
        page,
        field.rotationDeg,
      );
      const appearanceFont = fieldFont ?? form.getDefaultFont();
      if (field.options) ol.setOptions(field.options);

      if (field.isMultiSelect) ol.enableMultiselect();
      else ol.disableMultiselect();

      if (field.value) {
        const vals = field.isMultiSelect
          ? field.value.split("\n").filter(Boolean)
          : [field.value];
        try {
          ol.select(vals);
        } catch (e) {
          console.warn("Failed to select values for option list", e);
        }
      }

      if (field.toolTip) {
        ol.acroField.dict.set(PDFName.of("TU"), PDFString.of(field.toolTip));
      }

      if (field.style?.fontSize) ol.setFontSize(field.style.fontSize);
      updateExportFieldAppearance(
        ol,
        () => {
          try {
            ol.updateAppearances(appearanceFont);
          } catch (e) {
            console.warn("Failed to update option list appearances", e);
            return false;
          }
        },
        options?.context,
      );
    } else {
      const dd = getOrCreateExportField(
        field.name,
        () => form.getDropdown(field.name),
        () => form.createDropdown(field.name),
        options?.context,
      );

      dd.addToPage(page, { ...commonOpts, font: fieldFont });
      applyWidgetExportRotation(
        dd.acroField.getWidgets().at(-1),
        page,
        field.rotationDeg,
      );
      const appearanceFont = fieldFont ?? form.getDefaultFont();
      if (field.options) dd.setOptions(field.options);
      if (field.allowCustomValue) dd.enableEditing();

      if (field.value) {
        try {
          dd.select(field.value);
        } catch (e) {
          console.warn("Failed to select value for dropdown", e);
        }
      }

      if (field.toolTip) {
        dd.acroField.dict.set(PDFName.of("TU"), PDFString.of(field.toolTip));
      }

      if (field.style?.fontSize) dd.setFontSize(field.style.fontSize);
      updateExportFieldAppearance(
        dd,
        () => {
          try {
            dd.updateAppearances(appearanceFont);
          } catch (e) {
            console.warn("Failed to update dropdown appearances", e);
            return false;
          }
        },
        options?.context,
      );
    }
  }
}

export class RadioControlExporter implements IControlExporter {
  shouldExport(field: FormField): boolean {
    return field.type === FieldType.RADIO;
  }

  save(
    form: PDFForm,
    field: FormField,
    fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
    options?: ControlExportOptions,
  ): void {
    const page = form.doc.getPage(field.pageIndex);
    const commonOpts = getCommonControlExportOpts(field, page, viewport);

    const rg = getOrCreateExportField(
      field.name,
      () => form.getRadioGroup(field.name),
      () => {
        const group = form.createRadioGroup(field.name);
        if (field.toolTip) {
          group.acroField.dict.set(
            PDFName.of("TU"),
            PDFString.of(field.toolTip),
          );
        }
        return group;
      },
      options?.context,
    );

    const val = field.radioValue || field.exportValue || `Choice_${field.id}`;
    rg.addOptionToPage(val, page, commonOpts);
    applyWidgetExportRotation(
      rg.acroField.getWidgets().at(-1),
      page,
      field.rotationDeg,
    );

    if (field.isChecked) {
      rg.select(val);
    }

    updateExportFieldAppearance(
      rg,
      () => {
        try {
          rg.updateAppearances();
        } catch (e) {
          console.warn("Failed to update radio appearances", e);
          return false;
        }
      },
      options?.context,
    );
  }
}

export { SignatureControlExporter } from "./SignatureControlExporter.js";
