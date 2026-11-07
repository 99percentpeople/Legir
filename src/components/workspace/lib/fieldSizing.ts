import { MIN_FIELD_SIZE } from "@/constants";
import type { FormField } from "@/types";

/** Enforce the size after snapping/ratio adjustment, keeping the opposite edge fixed. */
export function constrainResizedField(
  rect: FormField["rect"],
  handle: string,
  aspectRatio?: number,
): FormField["rect"] {
  let width = Math.max(MIN_FIELD_SIZE, rect.width);
  let height = Math.max(MIN_FIELD_SIZE, rect.height);
  if (aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0) {
    width = Math.max(width, MIN_FIELD_SIZE * aspectRatio);
    height = width / aspectRatio;
  }
  return {
    x: handle.includes("w") ? rect.x + rect.width - width : rect.x,
    y: handle.includes("n") ? rect.y + rect.height - height : rect.y,
    width,
    height,
  };
}
