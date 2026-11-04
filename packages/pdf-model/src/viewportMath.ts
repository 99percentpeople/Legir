export type PointLike = {
  x: number;
  y: number;
};

export type RectLike = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width?: number;
  height?: number;
};

const getRectWidth = (rect: RectLike) =>
  typeof rect.width === "number" ? rect.width : rect.right - rect.left;

const getRectHeight = (rect: RectLike) =>
  typeof rect.height === "number" ? rect.height : rect.bottom - rect.top;

export const getRectCenter = (rect: RectLike): PointLike => ({
  x: rect.left + getRectWidth(rect) / 2,
  y: rect.top + getRectHeight(rect) / 2,
});

export const getDistanceSquaredBetweenPoints = (a: PointLike, b: PointLike) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export const getDistanceBetweenPoints = (a: PointLike, b: PointLike) =>
  Math.sqrt(getDistanceSquaredBetweenPoints(a, b));

export const getPointToRectDistanceSquared = (
  point: PointLike,
  rect: RectLike,
) => {
  const dx =
    point.x < rect.left
      ? rect.left - point.x
      : point.x > rect.right
        ? point.x - rect.right
        : 0;
  const dy =
    point.y < rect.top
      ? rect.top - point.y
      : point.y > rect.bottom
        ? point.y - rect.bottom
        : 0;
  return dx * dx + dy * dy;
};

export const pickClosestRectCandidate = <T>(
  point: PointLike,
  candidates: T[],
  getRect: (candidate: T) => RectLike,
) => {
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = getPointToRectDistanceSquared(point, getRect(candidate));
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      if (distance === 0) break;
    }
  }

  return best;
};
