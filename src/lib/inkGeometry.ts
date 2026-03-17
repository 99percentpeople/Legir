import type { Annotation } from "@/types";

type InkPoint = { x: number; y: number };
type InkRect = { x: number; y: number; width: number; height: number };

const getStrokePath = (points: InkPoint[]) => {
  if (points.length === 0) return "";
  if (points.length < 2) return `M ${points[0].x} ${points[0].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i];
    const nextPoint = points[i + 1];
    const midX = (point.x + nextPoint.x) / 2;
    const midY = (point.y + nextPoint.y) / 2;
    d += ` Q ${point.x} ${point.y}, ${midX} ${midY}`;
  }

  const lastPoint = points[points.length - 1];
  d += ` L ${lastPoint.x} ${lastPoint.y}`;

  return d;
};

export const getInkStrokes = (
  annotation: Pick<Annotation, "points" | "strokes">,
) => {
  if (annotation.strokes && annotation.strokes.length > 0) {
    return annotation.strokes;
  }
  if (annotation.points && annotation.points.length > 0) {
    return [annotation.points];
  }
  return [] as InkPoint[][];
};

export const getInkBoundingRect = (
  strokes: InkPoint[][],
  thickness: number | undefined,
): InkRect | undefined => {
  if (strokes.length === 0) return undefined;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of strokes) {
    for (const point of stroke) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  if (minX === Infinity) return undefined;

  const padding = (thickness ?? 1) / 2;
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
};

export const getInkSvgPath = (strokes: InkPoint[][]) => {
  if (strokes.length === 0) return undefined;

  const path = strokes.map(getStrokePath).filter(Boolean).join(" ");
  return path || undefined;
};

export const prepareInkAnnotationForStore = (
  annotation: Annotation,
  options?: {
    recomputeRect?: boolean;
    recomputeSvgPath?: boolean;
  },
): Annotation => {
  if (annotation.type !== "ink") return annotation;

  const strokes = getInkStrokes(annotation);
  if (strokes.length === 0) return annotation;

  const nextPoints =
    annotation.points && annotation.points.length > 0
      ? annotation.points
      : strokes[0];

  const shouldRecomputeRect =
    options?.recomputeRect === true || annotation.rect === undefined;
  const shouldRecomputeSvgPath =
    options?.recomputeSvgPath === true || !annotation.svgPath;

  return {
    ...annotation,
    points: nextPoints,
    rect: shouldRecomputeRect
      ? (getInkBoundingRect(strokes, annotation.thickness) ?? annotation.rect)
      : annotation.rect,
    svgPath: shouldRecomputeSvgPath
      ? (getInkSvgPath(strokes) ?? annotation.svgPath)
      : annotation.svgPath,
  };
};

export const prepareAnnotationsForStore = (annotations: Annotation[]) =>
  annotations.map((annotation) => prepareInkAnnotationForStore(annotation));
