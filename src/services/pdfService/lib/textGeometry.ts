import type {
  TextItem,
  TextMarkedContent,
  TextStyle,
} from "pdfjs-dist/types/src/display/api";

export const DEFAULT_PDF_TEXT_STYLE: TextStyle = {
  ascent: 0.8,
  descent: -0.2,
  vertical: false,
  fontFamily: "sans-serif",
};

export const isMarkedContent = (
  item: TextItem | TextMarkedContent,
): item is TextMarkedContent => !("str" in item);

export const isTextItem = (
  item: TextItem | TextMarkedContent,
): item is TextItem => "str" in item;

export const getItemTransform = (item: TextItem) => {
  if (Array.isArray(item.transform) && item.transform.length >= 6) {
    return item.transform as number[];
  }
  return [1, 0, 0, 1, 0, 0];
};

export const transform = (m1: number[], m2: number[]) => {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
};

export const normalizeRotationDeg = (deg: number) => {
  if (!Number.isFinite(deg)) return 0;
  let value = deg % 360;
  if (value <= -180) value += 360;
  if (value > 180) value -= 360;
  return value;
};

export const deltaRotationDeg = (a: number, b: number) => {
  return normalizeRotationDeg(a - b);
};

export const getAxes = (rotationDeg: number) => {
  const theta = (rotationDeg * Math.PI) / 180;
  let dirX = Math.cos(theta);
  let dirY = Math.sin(theta);

  if (Math.abs(dirX) >= Math.abs(dirY)) {
    if (dirX < 0) {
      dirX = -dirX;
      dirY = -dirY;
    }
  } else if (dirY < 0) {
    dirX = -dirX;
    dirY = -dirY;
  }

  return {
    dirX,
    dirY,
    normX: -dirY,
    normY: dirX,
  };
};

export const projectPointsInterval = (
  points: Array<[number, number]>,
  axisX: number,
  axisY: number,
) => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const [x, y] of points) {
    const value = x * axisX + y * axisY;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  return { min, max };
};

export const intervalDistance = (
  left: { min: number; max: number },
  right: { min: number; max: number },
) => {
  if (left.max < right.min) return right.min - left.max;
  if (right.max < left.min) return left.min - right.max;
  return 0;
};
