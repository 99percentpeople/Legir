import { FieldType, type FormField } from "./types.js";

/** Excludes location, names and interaction flags: those do not alter the normal appearance. */
export function getFormAppearanceKey(field: FormField): string {
  const s = field.style ?? {},
    f = field.buttonImageFit;
  return JSON.stringify([
    field.type,
    field.rect.width,
    field.rect.height,
    field.rotationDeg ?? 0,
    s.borderColor,
    s.backgroundColor,
    s.borderWidth,
    s.borderStyle,
    s.textColor,
    s.fontSize,
    s.fontFamily,
    s.isTransparent,
    field.buttonCaption ?? "",
    field.buttonLayout ?? 0,
    field.buttonImage === undefined ? "native-icon" : field.buttonImage,
    f?.scaleMode ?? "contain",
    f?.alignment ?? [0.5, 0.5],
    f?.when ?? "always",
    f?.fitBounds ?? false,
  ]);
}
export const canPreserveFormAppearance = (field: FormField) =>
  !!field.sourceAppearanceKey &&
  field.sourceAppearanceKey === getFormAppearanceKey(field);

/** A copied field must not borrow another field's native references or signature value. */
export function detachFormFieldSource(field: FormField): FormField {
  const {
    sourcePdfRef: _ref,
    sourceAppearance: _appearance,
    sourceAppearanceKey: _key,
    buttonIconPreview,
    signature: _signature,
    ...copy
  } = field;
  return {
    ...copy,
    ...(field.type === FieldType.BUTTON
      ? {
          buttonImage:
            field.buttonImage ??
            (field.buttonImage === null ? null : buttonIconPreview),
        }
      : {}),
  };
}
