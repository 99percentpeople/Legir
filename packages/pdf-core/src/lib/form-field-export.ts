import { isListBoxField } from "@legir/pdf-model/choiceFields";
import { PDFButton, PDFSignature } from "@legir/pdfium/authoring";
import {
  updateButtonWidget,
  applyFieldMetadata,
  applyFieldWidgetStyle,
} from "./button-field.js";
import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  type PDFFont,
  type PDFForm,
  PDFName,
  PDFNull,
  PDFOptionList,
  type PDFObject,
  type PDFPage,
  PDFRadioGroup,
  PDFRef,
  PDFTextField,
  PDFWidgetAnnotation,
} from "@legir/pdfium/authoring";
import { FieldType, type FormField } from "@legir/pdf-model";
import { canPreserveFormAppearance } from "@legir/pdf-model/formAppearance";
import type {
  ControlExportOptions,
  FormExportContext,
  ViewportLike,
} from "../types.js";
import { updateExportFieldAppearance } from "./form-export-context.js";
import { pickControlValueFont } from "./font-selection.js";
import { pdfDebug } from "./debug.js";
import { flattenTextFieldAppearanceProvider } from "./text-field-appearance.js";
import {
  applyWidgetExportRotation,
  getCommonControlExportOpts,
} from "./control-export.js";
import { lookupInFieldChain, pdfObjToString } from "./pdf-import-utils.js";

type CapturedXfaEntry = {
  acroForm: PDFDict;
  value: PDFObject;
};

export const captureAcroFormXfaEntry = (
  pdfDoc: PDFDocument,
): CapturedXfaEntry | undefined => {
  try {
    const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm"));
    if (!(acroForm instanceof PDFDict)) return undefined;

    const xfa = acroForm.get(PDFName.of("XFA"));
    if (!xfa || xfa === PDFNull) return undefined;

    return {
      acroForm,
      value: xfa as PDFObject,
    };
  } catch {
    return undefined;
  }
};

export const restoreAcroFormXfaEntry = (
  entry: CapturedXfaEntry | undefined,
) => {
  if (!entry) return;

  try {
    entry.acroForm.set(PDFName.of("XFA"), entry.value);
  } catch (error) {
    console.warn("Failed to restore XFA form data", error);
  }
};

export const sourcePdfRefToFormKey = (
  ref: { objectNumber: number; generationNumber: number } | undefined,
) => (ref ? `${ref.objectNumber}:${ref.generationNumber}` : null);

const pdfRefToFormKey = (ref: PDFRef | undefined | null) =>
  ref ? `${ref.objectNumber}:${ref.generationNumber}` : null;

const collectPdfFieldRefs = (field: { ref?: PDFRef; acroField?: unknown }) => {
  const refs: PDFRef[] = [];
  if (field.ref instanceof PDFRef) refs.push(field.ref);

  try {
    const acroField = field.acroField as
      | { Kids?: () => PDFArray | undefined }
      | undefined;
    const kids = acroField?.Kids?.();
    if (kids instanceof PDFArray) {
      for (let index = 0; index < kids.size(); index++) {
        const kid = kids.get(index);
        if (kid instanceof PDFRef && kid !== field.ref) refs.push(kid);
      }
    }
  } catch {
    // Ignore malformed field trees.
  }

  return refs;
};

export const fieldMatchesSourcePdfRef = (
  field: {
    ref?: PDFRef;
    acroField?: unknown;
  },
  sourceKeys: Set<string>,
) => {
  if (sourceKeys.size === 0) return false;
  return collectPdfFieldRefs(field).some((ref) => {
    const key = pdfRefToFormKey(ref);
    return !!key && sourceKeys.has(key);
  });
};

const findFieldBySourcePdfRef = (form: PDFForm, field: FormField) => {
  const sourceKey = sourcePdfRefToFormKey(field.sourcePdfRef);
  if (!sourceKey) return undefined;
  const sourceKeys = new Set([sourceKey]);
  return form
    .getFields()
    .find((candidate) => fieldMatchesSourcePdfRef(candidate, sourceKeys));
};

const pageContainsAnnotRef = (page: PDFPage, refKey: string) => {
  const annots = page.node.Annots();
  if (!(annots instanceof PDFArray)) return false;

  for (let index = 0; index < annots.size(); index++) {
    const ref = annots.get(index);
    if (ref instanceof PDFRef && pdfRefToFormKey(ref) === refKey) return true;
  }
  return false;
};

const updateSourcePdfFieldWidget = (
  form: PDFForm,
  field: FormField,
  viewport?: ViewportLike,
  context?: FormExportContext,
) => {
  const sourceKey = sourcePdfRefToFormKey(field.sourcePdfRef);
  if (!sourceKey || !field.sourcePdfRef) return false;

  const sourceRef = PDFRef.of(
    field.sourcePdfRef.objectNumber,
    field.sourcePdfRef.generationNumber,
  );
  const sourceWidgetDict = form.doc.context.lookup(sourceRef);
  if (!(sourceWidgetDict instanceof PDFDict)) return false;
  if (
    pdfObjToString(sourceWidgetDict.lookup(PDFName.of("Subtype"))) !== "Widget"
  ) {
    return false;
  }
  const sourceWidget = PDFWidgetAnnotation.fromDict(sourceWidgetDict);

  const targetPage = form.doc.getPage(field.pageIndex);
  const bounds = getCommonControlExportOpts(field, targetPage, viewport);
  sourceWidget.setRectangle({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });
  applyWidgetExportRotation(sourceWidget, targetPage, field.rotationDeg);

  const isOnTargetPage = context
    ? context.widgetRefsByPage.get(targetPage)?.has(sourceKey)
    : pageContainsAnnotRef(targetPage, sourceKey);
  if (!isOnTargetPage) {
    const sourceKeys = new Set([sourceKey]);
    for (const page of form.doc.getPages()) {
      removeRefsFromPageAnnots(page, sourceKeys);
      context?.widgetRefsByPage.get(page)?.delete(sourceKey);
    }
    targetPage.node.addAnnot(sourceRef);
    context?.widgetRefsByPage.get(targetPage)?.add(sourceKey);
  }
  sourceWidget.setP(targetPage.ref);

  return true;
};

const isSupportedSourceWidget = (widget: PDFDict) => {
  const fieldType = pdfObjToString(lookupInFieldChain(widget, "FT"));
  if (fieldType === "Tx" || fieldType === "Ch" || fieldType === "Sig") {
    return true;
  }
  if (fieldType !== "Btn") return false;

  return true;
};

const removeRefFromPdfArray = (array: PDFArray, refKey: string) => {
  let removed = 0;
  for (let index = array.size() - 1; index >= 0; index--) {
    const ref = array.get(index);
    if (ref instanceof PDFRef && pdfRefToFormKey(ref) === refKey) {
      array.remove(index);
      removed += 1;
    }
  }
  return removed;
};

export const removeMissingOrphanSourcePdfFieldWidgets = (
  form: Pick<PDFForm, "doc" | "getFields">,
  sourceKeys: Set<string>,
) => {
  const registeredFieldRefKeys = new Set(
    form
      .getFields()
      .flatMap((field) => collectPdfFieldRefs(field))
      .map((ref) => pdfRefToFormKey(ref))
      .filter((key): key is string => !!key),
  );
  const orphanWidgets = new Map<string, { ref: PDFRef; parentRef?: PDFRef }>();

  for (const page of form.doc.getPages()) {
    const annots = page.node.Annots();
    if (!(annots instanceof PDFArray)) continue;

    for (let index = 0; index < annots.size(); index++) {
      const ref = annots.get(index);
      if (!(ref instanceof PDFRef)) continue;
      const key = pdfRefToFormKey(ref);
      if (!key || registeredFieldRefKeys.has(key) || sourceKeys.has(key)) {
        continue;
      }

      const widget = annots.lookup(index);
      if (!(widget instanceof PDFDict)) continue;
      if (
        pdfObjToString(widget.lookup(PDFName.of("Subtype"))) !== "Widget" ||
        !isSupportedSourceWidget(widget)
      ) {
        continue;
      }

      const parent = widget.get(PDFName.of("Parent"));
      orphanWidgets.set(key, {
        ref,
        parentRef: parent instanceof PDFRef ? parent : undefined,
      });
    }
  }

  if (orphanWidgets.size === 0) return 0;

  const orphanKeys = new Set(orphanWidgets.keys());
  for (const page of form.doc.getPages()) {
    removeRefsFromPageAnnots(page, orphanKeys);
  }

  for (const [key, { ref, parentRef }] of orphanWidgets) {
    if (parentRef) {
      const parent = form.doc.context.lookup(parentRef);
      if (parent instanceof PDFDict) {
        const kids = parent.lookup(PDFName.of("Kids"));
        if (kids instanceof PDFArray) removeRefFromPdfArray(kids, key);
      }
    }
    form.doc.context.delete(ref);
  }

  return orphanWidgets.size;
};

export const removeMissingSourcePdfFieldWidgets = (
  form: PDFForm,
  field: {
    acroField?: unknown;
  },
  sourceKeys: Set<string>,
) => {
  if (sourceKeys.size === 0) return 0;

  const acroField = field.acroField as
    | { Kids?: () => PDFArray | undefined }
    | undefined;
  const kids = acroField?.Kids?.();
  if (!(kids instanceof PDFArray)) return 0;

  const indexedKidRefs: Array<{ index: number; ref: PDFRef; key: string }> = [];
  for (let index = 0; index < kids.size(); index++) {
    const kid = kids.get(index);
    if (!(kid instanceof PDFRef)) continue;
    const key = pdfRefToFormKey(kid);
    if (key) indexedKidRefs.push({ index, ref: kid, key });
  }

  // Only prune a field when at least one current control explicitly points to
  // one of its widgets. This avoids treating a parent-field ref as a widget ref.
  if (!indexedKidRefs.some(({ key }) => sourceKeys.has(key))) return 0;

  const refsToRemove = indexedKidRefs.filter(({ key }) => !sourceKeys.has(key));
  if (refsToRemove.length === 0) return 0;

  const refKeysToRemove = new Set(refsToRemove.map(({ key }) => key));
  for (const page of form.doc.getPages()) {
    removeRefsFromPageAnnots(page, refKeysToRemove);
  }

  const radio = field instanceof PDFRadioGroup ? field : undefined;
  const radioOptions = radio?.acroField.Opt();
  for (const { index, ref } of refsToRemove.sort(
    (left, right) => right.index - left.index,
  )) {
    kids.remove(index);
    if (radioOptions instanceof PDFArray && index < radioOptions.size())
      radioOptions.remove(index);
    form.doc.context.delete(ref);
  }

  if (
    radio &&
    !radio.acroField.getOnValues().includes(radio.acroField.getValue())
  )
    radio.clear();
  return refsToRemove.length;
};

const removeRefsFromPageAnnots = (page: PDFPage, refKeys: Set<string>) => {
  const annots = page.node.Annots();
  if (!(annots instanceof PDFArray)) return;

  const toRemove: number[] = [];
  for (let index = 0; index < annots.size(); index++) {
    const raw = annots.get(index);
    if (raw instanceof PDFRef) {
      const key = pdfRefToFormKey(raw);
      if (key && refKeys.has(key)) toRemove.push(index);
    }
  }

  toRemove
    .sort((left, right) => right - left)
    .forEach((index) => annots.remove(index));
};

const removeAcroFormFieldRef = (pdfDoc: PDFDocument, fieldRef?: PDFRef) => {
  if (!fieldRef) return;
  try {
    const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm"));
    if (!(acroForm instanceof PDFDict)) return;
    const fields = acroForm.lookup(PDFName.of("Fields"));
    if (!(fields instanceof PDFArray)) return;
    const index = fields.indexOf(fieldRef);
    if (typeof index === "number" && index !== -1) fields.remove(index);
  } catch {
    // Ignore malformed AcroForm trees.
  }
};

export const safeRemovePdfField = (
  form: PDFForm,
  field: {
    ref?: PDFRef;
    acroField?: unknown;
  } & { getName?: () => string },
) => {
  const refs = collectPdfFieldRefs(field);
  const refKeys = new Set(
    refs
      .map((ref) => pdfRefToFormKey(ref))
      .filter((key): key is string => !!key),
  );

  for (const page of form.doc.getPages()) {
    removeRefsFromPageAnnots(page, refKeys);
  }

  if (field.acroField) {
    try {
      const acroForm = form.acroForm as unknown as {
        removeField?: (acroField: unknown) => void;
      };
      acroForm.removeField?.(field.acroField);
    } catch {
      removeAcroFormFieldRef(form.doc, field.ref);
    }
  } else {
    removeAcroFormFieldRef(form.doc, field.ref);
  }

  for (const ref of refs) {
    try {
      form.doc.context.delete(ref);
    } catch {
      // Ignore cleanup failures.
    }
  }
};

export const updateExistingSourceField = async (
  form: PDFForm,
  field: FormField,
  fontMap?: Map<string, PDFFont>,
  options?: ControlExportOptions & { viewport?: ViewportLike },
) => {
  const initialField =
    options?.context?.findField(field) ?? findFieldBySourcePdfRef(form, field);
  if (initialField instanceof PDFSignature && initialField.getSignatureInfo()) {
    if (field.type !== FieldType.SIGNATURE)
      throw new Error("Cannot convert a populated signature field");
    return true; // Never rewrite a signer's /V, widget geometry or appearance.
  }
  const didUpdateSourceWidget = updateSourcePdfFieldWidget(
    form,
    field,
    options?.viewport,
    options?.context,
  );
  let existingField: ReturnType<PDFForm["getFields"]>[number] | undefined;
  try {
    existingField = options?.context
      ? options.context.findField(field)
      : (findFieldBySourcePdfRef(form, field) ??
        form.getFieldMaybe(field.name));
  } catch (error) {
    pdfDebug("export:forms", "sourceFieldLookupFailed", () => ({
      name: field.name,
      type: field.type,
      error: error instanceof Error ? error.message : String(error),
    }));
    existingField = undefined;
  }
  if (!existingField) {
    pdfDebug("export:forms", "sourceFieldLookupMiss", () => ({
      name: field.name,
      type: field.type,
    }));
    return didUpdateSourceWidget;
  }

  if (field.sourcePdfRef && !didUpdateSourceWidget) {
    const source = form.doc.context.lookup(
      PDFRef.of(
        field.sourcePdfRef.objectNumber,
        field.sourcePdfRef.generationNumber,
      ),
    );
    if (!(source instanceof PDFDict)) return false;
  }
  if (existingField instanceof PDFButton && field.type === FieldType.BUTTON) {
    const dict =
      field.sourcePdfRef &&
      form.doc.context.lookup(
        PDFRef.of(
          field.sourcePdfRef.objectNumber,
          field.sourcePdfRef.generationNumber,
        ),
      );
    const widget =
      dict instanceof PDFDict &&
      dict.lookup(PDFName.of("Subtype")) === PDFName.of("Widget")
        ? PDFWidgetAnnotation.fromDict(dict)
        : existingField.acroField.getWidgets()[0];
    if (widget)
      await updateButtonWidget(
        existingField,
        widget,
        field,
        fontMap,
        options?.viewport,
      );
    return true;
  }
  if (
    existingField instanceof PDFSignature &&
    field.type === FieldType.SIGNATURE
  ) {
    applyFieldMetadata(existingField, field);
    const dict =
      field.sourcePdfRef &&
      form.doc.context.lookup(
        PDFRef.of(
          field.sourcePdfRef.objectNumber,
          field.sourcePdfRef.generationNumber,
        ),
      );
    const widget =
      dict instanceof PDFDict &&
      dict.lookup(PDFName.of("Subtype")) === PDFName.of("Widget")
        ? PDFWidgetAnnotation.fromDict(dict)
        : existingField.acroField.getWidgets()[0];
    if (widget) {
      if (canPreserveFormAppearance(field) && widget.getAppearances().normal) {
        // Unsigned signature widgets can also carry a custom author-provided appearance.
        form.markFieldAsClean(existingField.ref);
      } else {
        applyFieldWidgetStyle(widget, field, existingField, options?.viewport);
        existingField.updateWidgetAppearance(widget);
      }
    }
    return true;
  }
  const runExistingFieldUpdate = (step: string, update: () => void) => {
    try {
      update();
      return true;
    } catch (error) {
      pdfDebug("export:forms", "sourceFieldUpdateFailed", () => ({
        name: field.name,
        type: field.type,
        step,
        error: error instanceof Error ? error.message : String(error),
      }));
      return false;
    }
  };

  const updateAppearances = (update: () => void) => {
    updateExportFieldAppearance(
      existingField,
      () => runExistingFieldUpdate("updateAppearances", update),
      options?.context,
    );
  };
  const existingTypeName = existingField.constructor.name;

  try {
    if (field.type === FieldType.TEXT) {
      if (
        !(existingField instanceof PDFTextField) &&
        existingTypeName !== "PDFTextField"
      ) {
        return true;
      }
      const textField = existingField as PDFTextField;
      if (typeof field.value === "string") {
        runExistingFieldUpdate("setText", () => textField.setText(field.value));
      }
      if (field.style?.fontSize) {
        runExistingFieldUpdate("setFontSize", () =>
          textField.setFontSize(field.style!.fontSize!),
        );
      }
      runExistingFieldUpdate("setHorizontalAlignment", () =>
        textField.setHorizontalAlignment(field.horizontalAlignment),
      );
      runExistingFieldUpdate("setVerticalAlignment", () =>
        textField.setVerticalAlignment(field.verticalAlignment),
      );
      if (field.multiline) {
        runExistingFieldUpdate("enableMultiline", () =>
          textField.enableMultiline(),
        );
      }
      updateAppearances(() => {
        const font = pickControlValueFont(field, form, fontMap);
        if (options?.flattenAppearance) {
          textField.updateAppearances(font, flattenTextFieldAppearanceProvider);
        } else {
          textField.updateAppearances(font);
        }
      });
      return true;
    }

    if (field.type === FieldType.CHECKBOX) {
      if (
        !(existingField instanceof PDFCheckBox) &&
        existingTypeName !== "PDFCheckBox"
      ) {
        return true;
      }
      const checkbox = existingField as PDFCheckBox;
      runExistingFieldUpdate("setValue", () => {
        if (field.isChecked) checkbox.check();
        else checkbox.uncheck();
      });
      updateAppearances(() => checkbox.updateAppearances());
      return true;
    }

    if (field.type === FieldType.RADIO) {
      if (
        !(existingField instanceof PDFRadioGroup) &&
        existingTypeName !== "PDFRadioGroup"
      ) {
        return true;
      }
      const radio = existingField as PDFRadioGroup;
      const value = field.radioValue || field.exportValue;
      if (field.isChecked && value) {
        runExistingFieldUpdate("select", () => {
          // Imported controls carry the widget's appearance state (/AP), which
          // can differ from the export option (/Opt) accepted by select().
          const onValue = radio.acroField
            .getOnValues()
            .find((candidate) => candidate.decodeText() === value);
          if (onValue) {
            radio.acroField.setValue(onValue);
            form.markFieldAsDirty(radio.ref);
          } else {
            radio.select(value);
          }
        });
      }
      updateAppearances(() => radio.updateAppearances());
      return true;
    }

    if (field.type === FieldType.DROPDOWN) {
      if (isListBoxField(field)) {
        if (
          !(existingField instanceof PDFOptionList) &&
          existingTypeName !== "PDFOptionList"
        ) {
          return true;
        }
        const optionList = existingField as PDFOptionList;
        if (field.isMultiSelect) optionList.enableMultiselect();
        else optionList.disableMultiselect();
        if (field.options) {
          runExistingFieldUpdate("setOptions", () =>
            optionList.setOptions(field.options!),
          );
        }
        if (field.value !== undefined) {
          runExistingFieldUpdate("select", () => {
            if (!field.value) optionList.clear();
            else
              optionList.select(
                field.isMultiSelect
                  ? field.value.split("\n").filter(Boolean)
                  : field.value,
              );
          });
        }
        updateAppearances(() =>
          optionList.updateAppearances(
            pickControlValueFont(field, form, fontMap),
          ),
        );
      } else {
        if (
          !(existingField instanceof PDFDropdown) &&
          existingTypeName !== "PDFDropdown"
        ) {
          return true;
        }
        const dropdown = existingField as PDFDropdown;
        if (field.options) {
          runExistingFieldUpdate("setOptions", () =>
            dropdown.setOptions(field.options!),
          );
        }
        if (field.value) {
          runExistingFieldUpdate("select", () => dropdown.select(field.value!));
        }
        updateAppearances(() =>
          dropdown.updateAppearances(
            pickControlValueFont(field, form, fontMap),
          ),
        );
      }
      return true;
    }
  } catch (error) {
    pdfDebug("export:forms", "sourceFieldUpdateFailed", () => ({
      name: field.name,
      type: field.type,
      step: "unexpected",
      error: error instanceof Error ? error.message : String(error),
    }));
    return true;
  }

  return true;
};
