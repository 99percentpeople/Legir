import type { ThumbnailContent } from "../types";
import { canPreserveSourceAnnotation } from "./annotation-layer-order";

/** Widgets and edited/deleted annotations are replaced by live controls. */
export const getThumbnailSourceAnnotations = (content: ThumbnailContent) =>
  new Set([
    ...content.preserved.map((item) => item.sourcePdfRef.objectNumber),
    ...content.annotations
      .filter((a) => a.type !== "comment" && canPreserveSourceAnnotation(a))
      .map((a) => a.sourcePdfRef!.objectNumber),
  ]);
