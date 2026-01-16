import type { Annotation } from "@/types";

type Rect = { x: number; y: number; width: number; height: number };

export const getFocusRect = (annot: Annotation): Rect | undefined => {
  if (annot.rect) return annot.rect;

  if (annot.rects && annot.rects.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const r of annot.rects) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }

    if (minX !== Infinity) {
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
  }

  const strokes =
    annot.strokes && annot.strokes.length > 0
      ? annot.strokes
      : annot.points && annot.points.length > 0
        ? [annot.points]
        : [];
  if (strokes.length === 0) return undefined;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of strokes) {
    for (const p of stroke) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  if (minX === Infinity) return undefined;

  const padding = (annot.thickness ?? 1) / 2;
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
};
