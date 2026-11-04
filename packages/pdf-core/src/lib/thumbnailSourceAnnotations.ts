import { FieldType, type FormField } from "@legir/pdf-model";
import type { ThumbnailContent } from "../types.js";
import { canPreserveSourceAnnotation } from "./annotation-layer-order.js";

/** Populated signature widgets are immutable in the editor; keep their actual native appearance. */
export const preserveNativeSignature = (field: FormField) =>
  field.type === FieldType.SIGNATURE &&
  field.signature?.present === true &&
  !!field.sourcePdfRef;

/** Editable widgets are replaced by live controls; existing signatures are not recreated. */
export const getThumbnailSourceAnnotations = (content: ThumbnailContent) =>
  new Set([
    ...content.preserved.map((item) => item.sourcePdfRef.objectNumber),
    ...content.fields
      .filter(preserveNativeSignature)
      .map((field) => field.sourcePdfRef!.objectNumber),
    ...content.annotations
      .filter((a) => a.type !== "comment" && canPreserveSourceAnnotation(a))
      .map((a) => a.sourcePdfRef!.objectNumber),
  ]);
