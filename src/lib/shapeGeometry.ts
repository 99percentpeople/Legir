import type { Annotation } from "@/types";

export type ShapePoint = { x: number; y: number };
export type ShapeRect = { x: number; y: number; width: number; height: number };
export type ShapeType = NonNullable<Annotation["shapeType"]>;
export type ShapeArrowStyle = NonNullable<Annotation["shapeStartArrowStyle"]>;
export type ShapeArrowEndpoint = "start" | "end";

export const SHAPE_ARROW_STYLE_OPTIONS: ShapeArrowStyle[] = [
  "closed_arrow",
  "line_arrow",
  "hollow_arrow",
  "circle",
  "square",
  "diamond",
  "slash",
];

const MIN_RECT_DIMENSION = 1;

export const SHAPE_FILL_TYPES: ShapeType[] = [
  "square",
  "circle",
  "polygon",
  "cloud_polygon",
];
export const SHAPE_VERTEX_TYPES: ShapeType[] = [
  "line",
  "polyline",
  "polygon",
  "cloud_polygon",
  "arrow",
];

export const shapeSupportsFill = (shapeType?: ShapeType | null) =>
  !!shapeType && SHAPE_FILL_TYPES.includes(shapeType);

export const shapeSupportsVertices = (shapeType?: ShapeType | null) =>
  !!shapeType && SHAPE_VERTEX_TYPES.includes(shapeType);

export const shapeSupportsVertexInsertion = (shapeType?: ShapeType | null) =>
  shapeType === "line" ||
  shapeType === "arrow" ||
  shapeType === "polyline" ||
  shapeType === "polygon" ||
  shapeType === "cloud_polygon";

export const isOpenLineShapeType = (shapeType?: ShapeType | null) =>
  shapeType === "line" || shapeType === "polyline" || shapeType === "arrow";

export const isOpenLineEndpointIndex = (
  shapeType: ShapeType | null | undefined,
  pointCount: number,
  index: number,
) =>
  isOpenLineShapeType(shapeType) &&
  pointCount >= 2 &&
  (index === 0 || index === pointCount - 1);

export const getShapeTypeAfterPointInsertion = (
  shapeType: ShapeType,
): ShapeType => {
  if (shapeType === "line") return "polyline";
  return shapeType;
};

export const getShapeTypeAfterPointDeletion = (
  shapeType: ShapeType,
  remainingPointCount: number,
): ShapeType => {
  if (shapeType === "polygon") return "polygon";
  if (shapeType === "cloud_polygon") return "cloud_polygon";
  if (shapeType === "arrow") return "arrow";
  if (shapeType === "polyline" || shapeType === "line") {
    return remainingPointCount > 2 ? "polyline" : "line";
  }
  return shapeType;
};

export const getShapeTypeWithoutArrow = (pointCount: number): ShapeType =>
  pointCount > 2 ? "polyline" : "line";

export const getDefaultArrowSize = (thickness = 2) =>
  Math.max(10, Math.max(1, thickness) * 4);

export const normalizeShapeArrowStyle = (
  style: string | null | undefined,
): ShapeArrowStyle | null => {
  switch (style) {
    case "closed_arrow":
    case "circle":
    case "square":
    case "diamond":
    case "slash":
    case "line_arrow":
    case "hollow_arrow":
      return style;
    default:
      return null;
  }
};

export const getShapeArrowStyles = (
  annotation:
    | Pick<
        Annotation,
        | "shapeType"
        | "shapeStartArrow"
        | "shapeEndArrow"
        | "shapeStartArrowStyle"
        | "shapeEndArrowStyle"
      >
    | null
    | undefined,
) => {
  const start =
    normalizeShapeArrowStyle(annotation?.shapeStartArrowStyle) ??
    (annotation?.shapeStartArrow ? "closed_arrow" : null);
  const end =
    normalizeShapeArrowStyle(annotation?.shapeEndArrowStyle) ??
    (annotation?.shapeEndArrow
      ? "closed_arrow"
      : annotation?.shapeType === "arrow"
        ? "closed_arrow"
        : null);

  return { start, end };
};

export const getShapeArrowFlags = (
  annotation:
    | Pick<
        Annotation,
        | "shapeType"
        | "shapeStartArrow"
        | "shapeEndArrow"
        | "shapeStartArrowStyle"
        | "shapeEndArrowStyle"
      >
    | null
    | undefined,
) => {
  const styles = getShapeArrowStyles(annotation);
  return {
    start: styles.start !== null,
    end: styles.end !== null,
  };
};

export const getShapeArrowStyleUpdates = (styles: {
  start: ShapeArrowStyle | null;
  end: ShapeArrowStyle | null;
}) => {
  if (!styles.start && !styles.end) {
    return {
      shapeStartArrow: undefined,
      shapeEndArrow: undefined,
      shapeStartArrowStyle: undefined,
      shapeEndArrowStyle: undefined,
    };
  }

  return {
    shapeStartArrow: !!styles.start,
    shapeEndArrow: !!styles.end,
    shapeStartArrowStyle: styles.start ?? undefined,
    shapeEndArrowStyle: styles.end ?? undefined,
  };
};

export const hasAnyShapeArrow = (
  annotation:
    | Pick<
        Annotation,
        | "shapeType"
        | "shapeStartArrow"
        | "shapeEndArrow"
        | "shapeStartArrowStyle"
        | "shapeEndArrowStyle"
      >
    | null
    | undefined,
) => {
  const styles = getShapeArrowStyles(annotation);
  return !!styles.start || !!styles.end;
};

export const isClosedShapeType = (shapeType?: ShapeType | null) =>
  shapeType === "polygon" || shapeType === "cloud_polygon";

export const getShapeMinimumPointCount = (shapeType?: ShapeType | null) => {
  if (shapeType === "polygon" || shapeType === "cloud_polygon") return 3;
  if (shapeType === "arrow" || shapeType === "polyline") return 2;
  if (shapeType === "line") return 2;
  return 0;
};

export const clamp01 = (value: number) =>
  Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export const distanceSquared = (a: ShapePoint, b: ShapePoint) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export const snapShapePointToAngle = (
  anchor: ShapePoint,
  point: ShapePoint,
  stepDeg = 15,
): ShapePoint => {
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const distance = Math.hypot(dx, dy);

  if (distance < 0.001) {
    return point;
  }

  const stepRad = (Math.PI * stepDeg) / 180;
  const angle = Math.atan2(dy, dx);
  const snappedAngle = Math.round(angle / stepRad) * stepRad;

  return {
    x: anchor.x + Math.cos(snappedAngle) * distance,
    y: anchor.y + Math.sin(snappedAngle) * distance,
  };
};

const getSnappedAngleCandidateDirections = (
  anchor: ShapePoint,
  point: ShapePoint,
  stepDeg = 15,
) => {
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.001) return [];

  const stepRad = (Math.PI * stepDeg) / 180;
  const angle = Math.atan2(dy, dx);
  const rawStep = angle / stepRad;
  const candidateSteps = new Set([
    Math.floor(rawStep),
    Math.round(rawStep),
    Math.ceil(rawStep),
  ]);

  return [...candidateSteps].map((stepIndex) => {
    const snappedAngle = stepIndex * stepRad;
    return {
      x: Math.cos(snappedAngle),
      y: Math.sin(snappedAngle),
    };
  });
};

const getRayIntersection = (
  pointA: ShapePoint,
  dirA: ShapePoint,
  pointB: ShapePoint,
  dirB: ShapePoint,
): ShapePoint | null => {
  const determinant = dirA.x * dirB.y - dirA.y * dirB.x;
  if (Math.abs(determinant) < 0.0001) return null;

  const deltaX = pointB.x - pointA.x;
  const deltaY = pointB.y - pointA.y;
  const t = (deltaX * dirB.y - deltaY * dirB.x) / determinant;
  const u = (deltaX * dirA.y - deltaY * dirA.x) / determinant;

  if (t < -0.001 || u < -0.001) return null;

  return {
    x: pointA.x + dirA.x * t,
    y: pointA.y + dirA.y * t,
  };
};

export const snapShapePointBetweenAnchors = (
  previousAnchor: ShapePoint,
  nextAnchor: ShapePoint,
  point: ShapePoint,
  stepDeg = 15,
): ShapePoint => {
  const previousDirections = getSnappedAngleCandidateDirections(
    previousAnchor,
    point,
    stepDeg,
  );
  const nextDirections = getSnappedAngleCandidateDirections(
    nextAnchor,
    point,
    stepDeg,
  );

  if (!previousDirections.length || !nextDirections.length) {
    return point;
  }

  const snappedFromPrevious = snapShapePointToAngle(
    previousAnchor,
    point,
    stepDeg,
  );
  const snappedFromNext = snapShapePointToAngle(nextAnchor, point, stepDeg);
  let bestIntersection: ShapePoint | null = null;
  let bestIntersectionDistance = Infinity;

  for (const previousDirection of previousDirections) {
    for (const nextDirection of nextDirections) {
      const intersection = getRayIntersection(
        previousAnchor,
        previousDirection,
        nextAnchor,
        nextDirection,
      );
      if (!intersection) continue;
      const intersectionDistance = distanceSquared(intersection, point);
      if (intersectionDistance < bestIntersectionDistance) {
        bestIntersection = intersection;
        bestIntersectionDistance = intersectionDistance;
      }
    }
  }

  if (!bestIntersection) {
    return distanceSquared(snappedFromPrevious, point) <=
      distanceSquared(snappedFromNext, point)
      ? snappedFromPrevious
      : snappedFromNext;
  }

  return bestIntersection;
};

export const getShapeBoundingRect = (
  points: ShapePoint[],
  padding = 0,
): ShapeRect | null => {
  if (!points.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(MIN_RECT_DIMENSION, maxX - minX + padding * 2),
    height: Math.max(MIN_RECT_DIMENSION, maxY - minY + padding * 2),
  };
};

export const normalizeShapePointsToRect = (
  points: ShapePoint[],
  rect: ShapeRect,
): ShapePoint[] => {
  const width = Math.max(MIN_RECT_DIMENSION, rect.width);
  const height = Math.max(MIN_RECT_DIMENSION, rect.height);
  return points.map((point) => ({
    x: clamp01((point.x - rect.x) / width),
    y: clamp01((point.y - rect.y) / height),
  }));
};

export const denormalizeShapePointsFromRect = (
  normalizedPoints: ShapePoint[] | undefined,
  rect: ShapeRect | undefined,
): ShapePoint[] => {
  if (!normalizedPoints?.length || !rect) return [];

  return normalizedPoints.map((point) => ({
    x: rect.x + clamp01(point.x) * rect.width,
    y: rect.y + clamp01(point.y) * rect.height,
  }));
};

export const getRectAndNormalizedShapePoints = (
  points: ShapePoint[],
  padding = 0,
): { rect: ShapeRect; shapePoints: ShapePoint[] } | null => {
  const rect = getShapeBoundingRect(points, padding);
  if (!rect) return null;
  return {
    rect,
    shapePoints: normalizeShapePointsToRect(points, rect),
  };
};

export const getShapeAbsolutePoints = (
  annotation: Annotation,
): ShapePoint[] => {
  if (!annotation.rect) return [];
  if (annotation.shapePoints?.length) {
    return denormalizeShapePointsFromRect(
      annotation.shapePoints,
      annotation.rect,
    );
  }

  if (annotation.shapeType === "line" || annotation.shapeType === "arrow") {
    return [
      { x: annotation.rect.x, y: annotation.rect.y },
      {
        x: annotation.rect.x + annotation.rect.width,
        y: annotation.rect.y + annotation.rect.height,
      },
    ];
  }

  return [];
};

export const reverseShapePoints = (points: ShapePoint[]) =>
  [...points].reverse();

export const getPointToSegmentDistanceSquared = (
  point: ShapePoint,
  start: ShapePoint,
  end: ShapePoint,
) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return distanceSquared(point, start);

  const t =
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
  const clampedT = Math.max(0, Math.min(1, t));
  return distanceSquared(point, {
    x: start.x + clampedT * dx,
    y: start.y + clampedT * dy,
  });
};

export const getClosestShapeSegmentIndex = (
  points: ShapePoint[],
  target: ShapePoint,
  options?: { closed?: boolean; threshold?: number },
) => {
  if (points.length < 2) return null;

  const closed = options?.closed === true;
  const threshold =
    typeof options?.threshold === "number" && Number.isFinite(options.threshold)
      ? options.threshold
      : 12;
  const thresholdSq = threshold * threshold;

  let bestIndex: number | null = null;
  let bestDistance = Infinity;
  const maxIndex = closed ? points.length : points.length - 1;

  for (let index = 0; index < maxIndex; index++) {
    const start = points[index]!;
    const end = points[(index + 1) % points.length]!;
    const distance = getPointToSegmentDistanceSquared(target, start, end);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  if (bestIndex === null || bestDistance > thresholdSq) return null;
  return bestIndex;
};

export const insertShapePointAtSegment = (
  points: ShapePoint[],
  segmentIndex: number,
  point: ShapePoint,
) => {
  const next = [...points];
  next.splice(segmentIndex + 1, 0, point);
  return next;
};

export const removeShapePoint = (points: ShapePoint[], pointIndex: number) =>
  points.filter((_, index) => index !== pointIndex);

export const getShapePointsPathData = (
  points: ShapePoint[],
  options?: { closed?: boolean },
) => {
  if (!points.length) return "";
  const commands = [`M ${points[0]!.x} ${points[0]!.y}`];
  for (let index = 1; index < points.length; index++) {
    const point = points[index]!;
    commands.push(`L ${point.x} ${point.y}`);
  }
  if (options?.closed) commands.push("Z");
  return commands.join(" ");
};

export const getArrowHeadPoints = (
  points: ShapePoint[],
  thickness = 2,
  arrowSize = getDefaultArrowSize(thickness),
): [ShapePoint, ShapePoint, ShapePoint] | null => {
  if (points.length < 2) return null;
  const tip = points[points.length - 1]!;

  let basePoint = points[points.length - 2]!;
  for (let index = points.length - 2; index >= 0; index--) {
    const candidate = points[index]!;
    if (distanceSquared(candidate, tip) > 0.01) {
      basePoint = candidate;
      break;
    }
  }

  const dx = tip.x - basePoint.x;
  const dy = tip.y - basePoint.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 0.001) return null;

  const ux = dx / length;
  const uy = dy / length;
  const size =
    typeof arrowSize === "number" && Number.isFinite(arrowSize)
      ? Math.max(6, arrowSize)
      : getDefaultArrowSize(thickness);
  const halfWidth = size * 0.45;
  const base = {
    x: tip.x - ux * size,
    y: tip.y - uy * size,
  };
  const perp = { x: -uy, y: ux };

  return [
    tip,
    {
      x: base.x + perp.x * halfWidth,
      y: base.y + perp.y * halfWidth,
    },
    {
      x: base.x - perp.x * halfWidth,
      y: base.y - perp.y * halfWidth,
    },
  ];
};

export const getArrowHeadPointsForEndpoint = (
  points: ShapePoint[],
  endpoint: ShapeArrowEndpoint,
  thickness = 2,
  arrowSize = getDefaultArrowSize(thickness),
) =>
  getArrowHeadPoints(
    endpoint === "start" ? reverseShapePoints(points) : points,
    thickness,
    arrowSize,
  );

export const arrowStyleToPdfLineEndingName = (
  style: ShapeArrowStyle | null | undefined,
) => {
  switch (style) {
    case "closed_arrow":
      return "ClosedArrow";
    case "line_arrow":
      return "OpenArrow";
    case "hollow_arrow":
      return "ClosedArrow";
    case "circle":
      return "Circle";
    case "square":
      return "Square";
    case "diamond":
      return "Diamond";
    case "slash":
      return "Slash";
    default:
      return null;
  }
};

export const pdfLineEndingNameToArrowStyle = (
  value?: string | null,
): ShapeArrowStyle | null => {
  if (!value) return null;
  switch (value) {
    case "ClosedArrow":
    case "RClosedArrow":
      return "closed_arrow";
    case "OpenArrow":
    case "ROpenArrow":
      return "line_arrow";
    case "Circle":
      return "circle";
    case "Square":
      return "square";
    case "Diamond":
      return "diamond";
    case "Slash":
      return "slash";
    default:
      return null;
  }
};

export const getLineEndingMarker = (
  points: ShapePoint[],
  endpoint: ShapeArrowEndpoint,
  style: ShapeArrowStyle | null | undefined,
  thickness = 2,
  arrowSize = getDefaultArrowSize(thickness),
) => {
  if (!style || points.length < 2) return null;

  const endpointIndex = endpoint === "start" ? 0 : points.length - 1;
  const direction = endpoint === "start" ? 1 : -1;
  const tip = points[endpointIndex]!;
  let neighborIndex = endpointIndex + direction;
  let neighbor = points[neighborIndex];

  while (
    neighbor &&
    Math.abs(neighbor.x - tip.x) < 0.001 &&
    Math.abs(neighbor.y - tip.y) < 0.001
  ) {
    neighborIndex += direction;
    neighbor = points[neighborIndex];
  }

  if (!neighbor) return null;

  const dx = tip.x - neighbor.x;
  const dy = tip.y - neighbor.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return null;

  const ux = dx / length;
  const uy = dy / length;
  const perp = { x: -uy, y: ux };
  const size =
    typeof arrowSize === "number" && Number.isFinite(arrowSize)
      ? Math.max(6, arrowSize)
      : getDefaultArrowSize(thickness);

  const buildPolygonPath = (polygonPoints: ShapePoint[]) =>
    [
      `M ${polygonPoints[0]!.x} ${polygonPoints[0]!.y}`,
      ...polygonPoints.slice(1).map((point) => `L ${point.x} ${point.y}`),
      "Z",
    ].join(" ");

  switch (style) {
    case "closed_arrow": {
      const halfWidth = size * 0.45;
      const base = { x: tip.x - ux * size, y: tip.y - uy * size };
      return {
        trim: size,
        pathData: buildPolygonPath([
          tip,
          {
            x: base.x + perp.x * halfWidth,
            y: base.y + perp.y * halfWidth,
          },
          {
            x: base.x - perp.x * halfWidth,
            y: base.y - perp.y * halfWidth,
          },
        ]),
        fillMode: "stroke" as const,
      };
    }
    case "line_arrow": {
      const halfWidth = size * 0.45;
      const base = { x: tip.x - ux * size, y: tip.y - uy * size };
      return {
        trim: 0,
        pathData: [
          `M ${tip.x} ${tip.y}`,
          `L ${base.x + perp.x * halfWidth} ${base.y + perp.y * halfWidth}`,
          `M ${tip.x} ${tip.y}`,
          `L ${base.x - perp.x * halfWidth} ${base.y - perp.y * halfWidth}`,
        ].join(" "),
        fillMode: "none" as const,
      };
    }
    case "hollow_arrow": {
      const halfWidth = size * 0.45;
      const base = { x: tip.x - ux * size, y: tip.y - uy * size };
      return {
        trim: size,
        pathData: buildPolygonPath([
          tip,
          {
            x: base.x + perp.x * halfWidth,
            y: base.y + perp.y * halfWidth,
          },
          {
            x: base.x - perp.x * halfWidth,
            y: base.y - perp.y * halfWidth,
          },
        ]),
        fillMode: "none" as const,
      };
    }
    case "circle": {
      const radius = size * 0.36;
      const center = { x: tip.x - ux * radius, y: tip.y - uy * radius };
      const polygonPoints = Array.from({ length: 12 }, (_, index) => {
        const theta = (Math.PI * 2 * index) / 12;
        return {
          x: center.x + Math.cos(theta) * radius,
          y: center.y + Math.sin(theta) * radius,
        };
      });
      return {
        trim: radius * 2,
        pathData: buildPolygonPath(polygonPoints),
        fillMode: "none" as const,
      };
    }
    case "square": {
      const side = size * 0.78;
      const half = side / 2;
      const center = { x: tip.x - ux * half, y: tip.y - uy * half };
      return {
        trim: side,
        pathData: buildPolygonPath([
          {
            x: center.x + ux * half + perp.x * half,
            y: center.y + uy * half + perp.y * half,
          },
          {
            x: center.x + ux * half - perp.x * half,
            y: center.y + uy * half - perp.y * half,
          },
          {
            x: center.x - ux * half - perp.x * half,
            y: center.y - uy * half - perp.y * half,
          },
          {
            x: center.x - ux * half + perp.x * half,
            y: center.y - uy * half + perp.y * half,
          },
        ]),
        fillMode: "none" as const,
      };
    }
    case "diamond": {
      const halfWidth = size * 0.42;
      const inward = { x: tip.x - ux * size, y: tip.y - uy * size };
      const center = { x: tip.x - ux * (size / 2), y: tip.y - uy * (size / 2) };
      return {
        trim: size,
        pathData: buildPolygonPath([
          tip,
          {
            x: center.x + perp.x * halfWidth,
            y: center.y + perp.y * halfWidth,
          },
          inward,
          {
            x: center.x - perp.x * halfWidth,
            y: center.y - perp.y * halfWidth,
          },
        ]),
        fillMode: "none" as const,
      };
    }
    case "slash": {
      const half = size * 0.48;
      const center = {
        x: tip.x - ux * (size * 0.28),
        y: tip.y - uy * (size * 0.28),
      };
      return {
        trim: size * 0.45,
        pathData: [
          `M ${center.x + perp.x * half - ux * half * 0.15} ${center.y + perp.y * half - uy * half * 0.15}`,
          `L ${center.x - perp.x * half + ux * half * 0.15} ${center.y - perp.y * half + uy * half * 0.15}`,
        ].join(" "),
        fillMode: "none" as const,
      };
    }
    default:
      return null;
  }
};

export const getTrimmedOpenLinePointsForArrows = (
  points: ShapePoint[],
  styles: { start: ShapeArrowStyle | null; end: ShapeArrowStyle | null },
  thickness = 2,
  arrowSize = getDefaultArrowSize(thickness),
) => {
  if (points.length < 2) return points;

  const trimmed = points.map((point) => ({ ...point }));
  const trimEndpoint = (
    endpoint: ShapeArrowEndpoint,
    style: ShapeArrowStyle | null,
  ) => {
    const marker = getLineEndingMarker(
      trimmed,
      endpoint,
      style,
      thickness,
      arrowSize,
    );
    if (!marker) return;

    const endpointIndex = endpoint === "start" ? 0 : trimmed.length - 1;
    const direction = endpoint === "start" ? 1 : -1;
    const anchor = trimmed[endpointIndex]!;

    let neighborIndex = endpointIndex + direction;
    let neighbor = trimmed[neighborIndex];

    while (
      neighbor &&
      Math.abs(neighbor.x - anchor.x) < 0.001 &&
      Math.abs(neighbor.y - anchor.y) < 0.001
    ) {
      neighborIndex += direction;
      neighbor = trimmed[neighborIndex];
    }

    if (!neighbor) return;

    const dx = neighbor.x - anchor.x;
    const dy = neighbor.y - anchor.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.001) return;

    const otherStyle = endpoint === "start" ? styles.end : styles.start;
    const maxOffset =
      trimmed.length === 2 && !!style && !!otherStyle
        ? Math.max(0, length / 2 - 0.5)
        : Math.max(0, length - 0.5);
    const offset = Math.min(marker.trim, maxOffset);
    if (offset <= 0) return;

    const ux = dx / length;
    const uy = dy / length;
    trimmed[endpointIndex] = {
      x: anchor.x + ux * offset,
      y: anchor.y + uy * offset,
    };
  };

  trimEndpoint("start", styles.start);
  trimEndpoint("end", styles.end);

  return trimmed;
};

export const getCloudPathData = (
  rect: ShapeRect,
  intensity = 2,
  spacing = 28,
): string => {
  const x = rect.x;
  const y = rect.y;
  const width = Math.max(8, rect.width);
  const height = Math.max(8, rect.height);
  const targetSpacing = getCloudSpacing(spacing);
  const topCount = Math.max(2, Math.round(width / targetSpacing));
  const sideCount = Math.max(2, Math.round(height / targetSpacing));
  const stepX = width / topCount;
  const stepY = height / sideCount;
  const ratio = Math.max(0.18, Math.min(0.38, 0.18 + (intensity - 1) * 0.08));
  const bump = Math.max(4, Math.min(stepX, stepY) * ratio);
  const right = x + width;
  const bottom = y + height;
  const commands = [`M ${x} ${y}`];

  for (let index = 0; index < topCount; index++) {
    const endX = x + stepX * (index + 1);
    const controlX = x + stepX * index + stepX / 2;
    commands.push(`Q ${controlX} ${y - bump} ${endX} ${y}`);
  }

  for (let index = 0; index < sideCount; index++) {
    const endY = y + stepY * (index + 1);
    const controlY = y + stepY * index + stepY / 2;
    commands.push(`Q ${right + bump} ${controlY} ${right} ${endY}`);
  }

  for (let index = 0; index < topCount; index++) {
    const endX = right - stepX * (index + 1);
    const controlX = right - stepX * index - stepX / 2;
    commands.push(`Q ${controlX} ${bottom + bump} ${endX} ${bottom}`);
  }

  for (let index = 0; index < sideCount; index++) {
    const endY = bottom - stepY * (index + 1);
    const controlY = bottom - stepY * index - stepY / 2;
    commands.push(`Q ${x - bump} ${controlY} ${x} ${endY}`);
  }

  commands.push("Z");
  return commands.join(" ");
};

const getCloudBumpRatio = (intensity = 2) =>
  Math.max(0.18, Math.min(0.38, 0.18 + (intensity - 1) * 0.08));

const getPolygonSignedArea = (points: ShapePoint[]) => {
  let signedArea = 0;

  for (let index = 0; index < points.length; index++) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    signedArea += current.x * next.y - next.x * current.y;
  }

  return signedArea / 2;
};

const getPolygonCloudCentroid = (points: ShapePoint[]) => {
  if (!points.length) {
    return { x: 0, y: 0 };
  }

  const signedArea = getPolygonSignedArea(points);
  let centroidX = 0;
  let centroidY = 0;

  for (let index = 0; index < points.length; index++) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    const cross = current.x * next.y - next.x * current.y;
    centroidX += (current.x + next.x) * cross;
    centroidY += (current.y + next.y) * cross;
  }

  if (Math.abs(signedArea) < 0.001) {
    const total = points.reduce(
      (acc, point) => ({
        x: acc.x + point.x,
        y: acc.y + point.y,
      }),
      { x: 0, y: 0 },
    );
    return {
      x: total.x / points.length,
      y: total.y / points.length,
    };
  }

  const factor = 1 / (3 * signedArea);
  return {
    x: centroidX * factor,
    y: centroidY * factor,
  };
};

const getPolygonSegmentOutwardNormal = (args: {
  dx: number;
  dy: number;
  length: number;
  bump: number;
  start: ShapePoint;
  signedArea: number;
  centroid: ShapePoint | null;
}) => {
  const { dx, dy, length, bump, start, signedArea, centroid } = args;
  const leftNormal = { x: -dy / length, y: dx / length };
  const rightNormal = { x: dy / length, y: -dx / length };

  if (Math.abs(signedArea) >= 0.001) {
    return signedArea >= 0 ? rightNormal : leftNormal;
  }

  if (!centroid) {
    return rightNormal;
  }

  const midPoint = {
    x: start.x + dx / 2,
    y: start.y + dy / 2,
  };
  const leftDistance = distanceSquared(
    {
      x: midPoint.x + leftNormal.x * bump,
      y: midPoint.y + leftNormal.y * bump,
    },
    centroid,
  );
  const rightDistance = distanceSquared(
    {
      x: midPoint.x + rightNormal.x * bump,
      y: midPoint.y + rightNormal.y * bump,
    },
    centroid,
  );

  return leftDistance >= rightDistance ? leftNormal : rightNormal;
};

export const getPolygonCloudGeometry = (
  points: ShapePoint[],
  options?: {
    intensity?: number;
    strokeWidth?: number;
    spacing?: number;
  },
) => {
  const intensity =
    typeof options?.intensity === "number" && Number.isFinite(options.intensity)
      ? options.intensity
      : 2;
  const strokeWidth =
    typeof options?.strokeWidth === "number" &&
    Number.isFinite(options.strokeWidth)
      ? Math.max(0, options.strokeWidth)
      : 0;
  const spacing = getCloudSpacing(options?.spacing);
  const ratio = getCloudBumpRatio(intensity);

  if (points.length < 3) {
    return {
      intensity,
      strokeWidth,
      spacing,
      overflow: strokeWidth / 2,
      pathData: getShapePointsPathData(points, { closed: true }),
    };
  }

  const signedArea = getPolygonSignedArea(points);
  const centroid =
    Math.abs(signedArea) < 0.001 ? getPolygonCloudCentroid(points) : null;
  const commands = [`M ${points[0]!.x} ${points[0]!.y}`];
  let maxBump = 0;
  let hasSegment = false;

  for (let index = 0; index < points.length; index++) {
    const start = points[index]!;
    const end = points[(index + 1) % points.length]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);

    if (length < 0.001) {
      continue;
    }

    hasSegment = true;
    const segmentCount = Math.max(1, Math.round(length / spacing));
    const step = length / segmentCount;
    const bump = Math.max(4, step * ratio);
    maxBump = Math.max(maxBump, bump);
    const outwardNormal = getPolygonSegmentOutwardNormal({
      dx,
      dy,
      length,
      bump,
      start,
      signedArea,
      centroid,
    });

    for (let segmentOffset = 0; segmentOffset < segmentCount; segmentOffset++) {
      const endT = (segmentOffset + 1) / segmentCount;
      const controlT = (segmentOffset + 0.5) / segmentCount;
      const segmentEnd = {
        x: start.x + dx * endT,
        y: start.y + dy * endT,
      };
      const controlPoint = {
        x: start.x + dx * controlT + outwardNormal.x * bump,
        y: start.y + dy * controlT + outwardNormal.y * bump,
      };
      commands.push(
        `Q ${controlPoint.x} ${controlPoint.y} ${segmentEnd.x} ${segmentEnd.y}`,
      );
    }
  }

  if (!hasSegment) {
    return {
      intensity,
      strokeWidth,
      spacing,
      overflow: strokeWidth / 2,
      pathData: getShapePointsPathData(points, { closed: true }),
    };
  }

  commands.push("Z");

  return {
    intensity,
    strokeWidth,
    spacing,
    overflow: maxBump + strokeWidth / 2,
    pathData: commands.join(" "),
  };
};

export const getPolygonCloudPathData = (
  points: ShapePoint[],
  intensity = 2,
  spacing = 28,
  strokeWidth = 0,
) =>
  getPolygonCloudGeometry(points, {
    intensity,
    spacing,
    strokeWidth,
  }).pathData;

export const getCloudSpacing = (spacing?: number) =>
  typeof spacing === "number" && Number.isFinite(spacing)
    ? Math.max(12, spacing)
    : 28;

export const getCloudGeometry = (
  rect: ShapeRect,
  options?: {
    intensity?: number;
    strokeWidth?: number;
    spacing?: number;
  },
) => {
  const intensity =
    typeof options?.intensity === "number" && Number.isFinite(options.intensity)
      ? options.intensity
      : 2;
  const strokeWidth =
    typeof options?.strokeWidth === "number" &&
    Number.isFinite(options.strokeWidth)
      ? Math.max(0, options.strokeWidth)
      : 0;
  const spacing = getCloudSpacing(options?.spacing);
  const inset = strokeWidth / 2;
  const pathRect = {
    x: rect.x + inset,
    y: rect.y + inset,
    width: Math.max(1, rect.width - inset * 2),
    height: Math.max(1, rect.height - inset * 2),
  };
  const topCount = Math.max(2, Math.round(pathRect.width / spacing));
  const sideCount = Math.max(2, Math.round(pathRect.height / spacing));
  const stepX = pathRect.width / topCount;
  const stepY = pathRect.height / sideCount;
  const ratio = getCloudBumpRatio(intensity);
  const bump = Math.max(4, Math.min(stepX, stepY) * ratio);
  const overflow = bump;

  return {
    intensity,
    strokeWidth,
    spacing,
    inset,
    bump,
    overflow,
    topCount,
    sideCount,
    stepX,
    stepY,
    pathRect,
  };
};
