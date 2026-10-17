import type { Annotation } from "@/types";

type InkPoint = { x: number; y: number };
type InkRect = { x: number; y: number; width: number; height: number };

type InkRenderPath = { d: string; dx: number; dy: number };
// Derived rendering data belongs to immutable stroke arrays, not the document
// snapshot. Entries never retain previous strokes; history/GC owns their lifetime.
const renderPaths = new WeakMap<InkPoint[] | InkPoint[][], InkRenderPath>();
const strokeKey = (annotation: Pick<Annotation, "points" | "strokes">) =>
  annotation.strokes?.length ? annotation.strokes : annotation.points;

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

export const getInkRenderPath = (
  annotation: Pick<Annotation, "points" | "strokes" | "svgPath">,
): InkRenderPath => {
  if (annotation.svgPath) return { d: annotation.svgPath, dx: 0, dy: 0 };
  const key = strokeKey(annotation);
  const cached = key && renderPaths.get(key);
  if (cached) return cached;
  const path = {
    d: getInkSvgPath(getInkStrokes(annotation)) ?? "",
    dx: 0,
    dy: 0,
  };
  if (key) renderPaths.set(key, path);
  return path;
};

/** Preserve canonical translated points for save/undo while reusing the SVG
 * commands. An arbitrary stroke edit gets a new key and builds its own path. */
export const cacheTranslatedInkPath = (
  source: Annotation,
  target: Pick<Annotation, "points" | "strokes">,
  dx: number,
  dy: number,
) => {
  const key = strokeKey(target);
  if (!key) return;
  // As before, the first edit of an imported ink regenerates from its InkList.
  const previous = getInkRenderPath({
    points: source.points,
    strokes: source.strokes,
  });
  renderPaths.set(key, {
    d: previous.d,
    dx: previous.dx + dx,
    dy: previous.dy + dy,
  });
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
  return {
    ...annotation,
    points: nextPoints,
    rect: shouldRecomputeRect
      ? (getInkBoundingRect(strokes, annotation.thickness) ?? annotation.rect)
      : annotation.rect,
    // Only imported appearances need serialization. Generated paths are cached
    // lazily by the renderer and can always be rebuilt from canonical strokes.
    svgPath: options?.recomputeSvgPath ? undefined : annotation.svgPath,
  };
};

export const prepareAnnotationsForStore = (annotations: Annotation[]) =>
  annotations.map((annotation) => prepareInkAnnotationForStore(annotation));
