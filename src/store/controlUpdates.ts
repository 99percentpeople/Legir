import { FieldType, type FormField, type Annotation } from "@/types";
import type { EditorStore } from "./store.types";
import { prepareInkAnnotationForStore } from "@legir/pdf-model/inkGeometry";
import {
  getFormFieldUpdateDirtyScopes,
  mergePdfPermissionDirtyScopes,
} from "@legir/pdf-model/pdfPermissions";

export function getFieldUpdate(
  state: EditorStore,
  id: string,
  updates: Partial<FormField>,
) {
  let nextFields = state.fields;
  const targetField = state.fields.find((field) => field.id === id);

  if (!targetField) return state;

  if (updates.isChecked === true && targetField.type === FieldType.RADIO) {
    nextFields = nextFields.map((field) =>
      field.name === targetField.name &&
      field.id !== id &&
      field.type === FieldType.RADIO
        ? { ...field, isChecked: false }
        : field,
    );
  }

  const propsToSync = [
    "value",
    "defaultValue",
    "placeholder",
    "options",
    "required",
    "readOnly",
    "toolTip",
    "multiline",
    "maxLength",
    "horizontalAlignment",
    "verticalAlignment",
  ];

  if (targetField.type !== FieldType.RADIO) {
    propsToSync.push("isChecked");
    propsToSync.push("isDefaultChecked");
  }

  const syncUpdates: Partial<FormField> = {};
  propsToSync.forEach((key) => {
    const typedKey = key as keyof FormField;
    if (
      updates[typedKey] !== undefined ||
      ((typedKey === "horizontalAlignment" ||
        typedKey === "verticalAlignment") &&
        Object.prototype.hasOwnProperty.call(updates, typedKey))
    ) {
      // @ts-expect-error index signature mismatch for dynamic keyof assignment
      syncUpdates[typedKey] = updates[typedKey];
    }
  });

  if (Object.keys(syncUpdates).length > 0) {
    nextFields = nextFields.map((field) =>
      field.name === targetField.name &&
      field.id !== id &&
      field.type === targetField.type
        ? { ...field, ...syncUpdates }
        : field,
    );
  }

  nextFields = nextFields.map((field) =>
    field.id === id ? { ...field, ...updates } : field,
  );

  return {
    fields: nextFields,
    isDirty: true,
    dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
      state.dirtyPermissionScopes,
      getFormFieldUpdateDirtyScopes(state.documentPermissions, updates),
    ),
  };
}

export function getAnnotationUpdate(
  state: EditorStore,
  id: string,
  updates: Partial<Annotation>,
) {
  const current = state.annotations.find((annotation) => annotation.id === id);
  const nextAuthor = updates.author ?? state.options.userName;

  const shouldMarkEdited = !!current?.sourcePdfRef && current.isEdited !== true;
  const shouldResetFontOnFirstEdit =
    shouldMarkEdited &&
    !!current?.sourcePdfFontMissing &&
    updates.fontFamily === undefined;

  const updatesWithTime = {
    ...updates,
    author: nextAuthor,
    updatedAt: new Date().toISOString(),
    ...(shouldMarkEdited ? { isEdited: true } : null),
    ...(shouldResetFontOnFirstEdit ? { fontFamily: "Helvetica" } : null),
  };
  const shouldRecomputeInkRect =
    current?.type === "ink" &&
    (updates.thickness !== undefined ||
      updates.strokes !== undefined ||
      updates.points !== undefined ||
      current.rect === undefined);
  const shouldRecomputeInkPath =
    current?.type === "ink" &&
    (updates.strokes !== undefined ||
      updates.points !== undefined ||
      !current.svgPath);

  return {
    annotations: state.annotations.map((annotation) =>
      annotation.id === id
        ? prepareInkAnnotationForStore(
            { ...annotation, ...updatesWithTime },
            {
              recomputeRect: shouldRecomputeInkRect,
              recomputeSvgPath: shouldRecomputeInkPath,
            },
          )
        : annotation,
    ),
    isDirty: true,
    dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
      state.dirtyPermissionScopes,
      { modifyAnnotations: true },
    ),
  };
}
