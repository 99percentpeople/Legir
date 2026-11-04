import { isListBoxField } from "@legir/pdf-model/choiceFields";
import { FieldType, type FormField } from "@legir/pdf-model";
import {
  PDFSignature,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
  PDFButton,
  type PDFForm,
  type PDFField,
  type PDFRef,
} from "@legir/pdfium/authoring";
import { sourcePdfRefToFormKey } from "./form-field-export.js";

/** Plan type conversions before building the export index or mutating native fields. */
export function planFieldTypeReplacements(
  form: PDFForm,
  fields: FormField[],
  existingFields: readonly PDFField[],
): Set<PDFRef> {
  const byRef = new Map<string, FormField[]>(),
    byName = new Map<string, FormField[]>();
  for (const field of fields) {
    const key = sourcePdfRefToFormKey(field.sourcePdfRef);
    if (key) byRef.set(key, [...(byRef.get(key) ?? []), field]);
    else byName.set(field.name, [...(byName.get(field.name) ?? []), field]);
  }
  const expected = (f: FormField) =>
    f.type === FieldType.TEXT
      ? "PDFTextField"
      : f.type === FieldType.CHECKBOX
        ? "PDFCheckBox"
        : f.type === FieldType.RADIO
          ? "PDFRadioGroup"
          : f.type === FieldType.DROPDOWN
            ? isListBoxField(f)
              ? "PDFOptionList"
              : "PDFDropdown"
            : f.type === FieldType.BUTTON
              ? "PDFButton"
              : "PDFSignature";
  const replacements = new Set<PDFRef>();
  for (const field of existingFields) {
    const targets = new Set(byName.get(field.getName()) ?? []);
    const refs = [
      field.ref,
      ...field.acroField
        .getWidgets()
        .map((widget) => form.doc.context.getObjectRef(widget.dict))
        .filter((ref): ref is PDFRef => !!ref),
    ];
    for (const ref of refs)
      for (const target of byRef.get(
        `${ref.objectNumber}:${ref.generationNumber}`,
      ) ?? [])
        targets.add(target);
    if (!targets.size) continue;
    const kinds = new Set<string>([...targets].map(expected));
    if (kinds.size > 1)
      throw new Error(
        `All widgets of field ${field.getName()} must use the same field type`,
      );
    const actual =
      field instanceof PDFTextField
        ? "PDFTextField"
        : field instanceof PDFCheckBox
          ? "PDFCheckBox"
          : field instanceof PDFRadioGroup
            ? "PDFRadioGroup"
            : field instanceof PDFDropdown
              ? "PDFDropdown"
              : field instanceof PDFOptionList
                ? "PDFOptionList"
                : field instanceof PDFButton
                  ? "PDFButton"
                  : field instanceof PDFSignature
                    ? "PDFSignature"
                    : field.constructor.name;
    if (!kinds.has(actual)) {
      if (field instanceof PDFSignature && field.getSignatureInfo())
        throw new Error("Cannot convert a populated signature field");
      replacements.add(field.ref);
    }
  }
  return replacements;
}
