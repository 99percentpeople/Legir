import type { OrderedControlEntry } from "@legir/pdf-model/controlLayerOrder";
import {
  getMovedAnnotationUpdates,
  getMovedFieldUpdates,
} from "@legir/pdf-model/controlMovement";
import { prepareInkAnnotationForStore } from "@legir/pdf-model/inkGeometry";

export type SelectionPreview = {
  x: number;
  y: number;
  ids: Set<string>;
  duplicate: boolean;
};

export function previewSelectedControls(
  entries: OrderedControlEntry[],
  preview: SelectionPreview | null,
): OrderedControlEntry[] {
  if (!preview) return entries;
  const move = (entry: OrderedControlEntry): OrderedControlEntry => {
    const control = entry.control;
    const id = preview.duplicate
      ? `duplicate-preview:${control.id}`
      : control.id;
    if (entry.kind === "field")
      return {
        kind: "field",
        control: {
          ...entry.control,
          ...getMovedFieldUpdates(entry.control, preview.x, preview.y),
          id,
        },
      };
    const annotation = {
      ...entry.control,
      ...getMovedAnnotationUpdates(entry.control, preview.x, preview.y),
      id,
    };
    return {
      kind: "annotation",
      control:
        annotation.type === "ink"
          ? prepareInkAnnotationForStore(annotation, {
              recomputeRect: true,
              recomputeSvgPath: true,
            })
          : annotation,
    };
  };
  // Copies are drawn above every original, matching their committed layer order.
  return preview.duplicate
    ? [
        ...entries,
        ...entries
          .filter((entry) => preview.ids.has(entry.control.id))
          .map(move),
      ]
    : entries.map((entry) =>
        preview.ids.has(entry.control.id) ? move(entry) : entry,
      );
}
