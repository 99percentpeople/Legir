import type { Annotation, FormField, MoveDirection } from "@/types";

export const getMoveDelta = (
  direction: MoveDirection,
  isFast?: boolean,
): { dx: number; dy: number } => {
  const step = isFast ? 10 : 1;
  return {
    dx: direction === "LEFT" ? -step : direction === "RIGHT" ? step : 0,
    dy: direction === "UP" ? -step : direction === "DOWN" ? step : 0,
  };
};

export const translateRect = (
  rect: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
) => ({
  ...rect,
  x: rect.x + dx,
  y: rect.y + dy,
});

export const translatePoint = (
  point: { x: number; y: number },
  dx: number,
  dy: number,
) => ({
  x: point.x + dx,
  y: point.y + dy,
});

export const getMovedFieldUpdates = (
  field: FormField,
  dx: number,
  dy: number,
): Partial<FormField> => ({
  rect: translateRect(field.rect, dx, dy),
});

export const getMovedAnnotationUpdates = (
  annotation: Annotation,
  dx: number,
  dy: number,
): Partial<Annotation> => {
  if (!annotation.rect) return {};

  if (annotation.type === "ink") {
    const nextStrokes = annotation.strokes?.map((stroke) =>
      stroke.map((point) => translatePoint(point, dx, dy)),
    );
    const nextPoints =
      annotation.points?.map((point) => translatePoint(point, dx, dy)) ??
      nextStrokes?.[0];

    return {
      ...(nextPoints ? { points: nextPoints } : null),
      ...(nextStrokes ? { strokes: nextStrokes } : null),
      appearanceStreamContent: undefined,
    };
  }

  if (annotation.type === "highlight" && annotation.rects?.length) {
    return {
      rect: translateRect(annotation.rect, dx, dy),
      rects: annotation.rects.map((rect) => translateRect(rect, dx, dy)),
    };
  }

  return {
    rect: translateRect(annotation.rect, dx, dy),
  };
};
