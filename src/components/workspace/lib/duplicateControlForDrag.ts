import { Annotation, FieldType, FormField } from "@/types";

const createDuplicateToken = () =>
  `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const createDuplicateId = (prefix: string) =>
  `${prefix}_${createDuplicateToken()}`;

const getDuplicatedFieldName = (field: FormField) => {
  if (field.type === FieldType.RADIO) {
    return field.name;
  }

  const match = field.name.match(/^(.*)_(\d+)$/);
  if (!match) {
    return `${field.name}_1`;
  }

  const prefix = match[1];
  const num = Number.parseInt(match[2], 10);
  return `${prefix}_${num + 1}`;
};

export const duplicateFieldForDrag = (field: FormField): FormField => ({
  ...field,
  id: createDuplicateId("field"),
  name: getDuplicatedFieldName(field),
  // Keep radio groups aligned while avoiding an immediate duplicate selection.
  isChecked: field.type === FieldType.RADIO ? false : field.isChecked,
  isDefaultChecked:
    field.type === FieldType.RADIO ? false : field.isDefaultChecked,
});

export const duplicateAnnotationForDrag = (
  annotation: Annotation,
): Annotation => {
  const duplicatedId = createDuplicateId(annotation.type);

  return {
    ...annotation,
    id: duplicatedId,
    updatedAt: undefined,
    sourcePdfRef: undefined,
    sourcePdfFontName: undefined,
    sourcePdfFontIsSubset: undefined,
    sourcePdfFontMissing: undefined,
    replies: annotation.replies?.map((reply) => ({
      ...reply,
      id: createDuplicateId("annotation_reply"),
      parentAnnotationId: duplicatedId,
      updatedAt: undefined,
      sourcePdfRef: undefined,
      isEdited: undefined,
    })),
    isEdited: undefined,
  };
};
