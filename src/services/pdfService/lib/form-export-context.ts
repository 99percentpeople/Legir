import { PDFArray, PDFRef, type PDFField, type PDFForm } from "@cantoo/pdf-lib";
import type { FormExportContext } from "../types";

const refKey = (ref: { objectNumber: number; generationNumber: number }) =>
  `${ref.objectNumber}:${ref.generationNumber}`;

/** Create after source-field cleanup; never share this state across exports. */
export const createFormExportContext = (form: PDFForm): FormExportContext => {
  const fieldsByName = new Map<string, PDFField>();
  const fieldsByRef = new Map<string, PDFField>();
  const pendingAppearances = new Map<PDFRef, () => void>();
  const widgetRefsByPage: FormExportContext["widgetRefsByPage"] = new Map();

  const registerField = (field: PDFField) => {
    // Match getFieldMaybe/find: duplicate names and refs use the first field.
    const name = field.getName();
    if (!fieldsByName.has(name)) fieldsByName.set(name, field);
    const refs = [field.ref];
    try {
      const kids = field.acroField.Kids();
      if (kids instanceof PDFArray) {
        for (let index = 0; index < kids.size(); index++) {
          const kid = kids.get(index);
          if (kid instanceof PDFRef) refs.push(kid);
        }
      }
    } catch {
      // A malformed widget list must not prevent name/parent-ref lookup.
    }
    for (const ref of refs) {
      const key = refKey(ref);
      if (!fieldsByRef.has(key)) fieldsByRef.set(key, field);
    }
  };

  for (const field of form.getFields()) registerField(field);
  for (const page of form.doc.getPages()) {
    const refs = new Set<string>();
    try {
      const annots = page.node.Annots();
      if (annots instanceof PDFArray) {
        for (let index = 0; index < annots.size(); index++) {
          const ref = annots.get(index);
          if (ref instanceof PDFRef) refs.add(refKey(ref));
        }
      }
    } catch {
      // Match annotation cleanup: a malformed, unrelated page must not stop export.
    }
    widgetRefsByPage.set(page, refs);
  }

  return {
    findField: (field) =>
      (field.sourcePdfRef
        ? fieldsByRef.get(refKey(field.sourcePdfRef))
        : undefined) ?? fieldsByName.get(field.name),
    registerField,
    widgetRefsByPage,
    scheduleAppearanceUpdate: (field, update) => {
      // A PDF field can own many widgets. Its last update must render all of
      // them once, after every widget's geometry and the shared value are final.
      pendingAppearances.set(field.ref, update);
    },
    flushAppearanceUpdates: () => {
      for (const update of pendingAppearances.values()) update();
      pendingAppearances.clear();
    },
  };
};

/** Avoid getFieldMaybe's full-tree scan (and a missing-field exception) on create. */
export const getOrCreateExportField = <T extends PDFField>(
  name: string,
  getField: () => T,
  createField: () => T,
  context?: FormExportContext,
): T => {
  if (!context || context.findField({ name })) {
    try {
      return getField();
    } catch {
      // Preserve the typed pdf-lib getter's behavior for conflicting names.
    }
  }
  const field = createField();
  context?.registerField(field);
  return field;
};

export const updateExportFieldAppearance = (
  field: PDFField,
  update: () => void,
  context?: FormExportContext,
) => {
  if (context) context.scheduleAppearanceUpdate(field, update);
  else update();
};
