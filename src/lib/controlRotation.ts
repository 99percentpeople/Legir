export type RotationRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RotationPoint = {
  x: number;
  y: number;
};

export type RotationResizeHandle =
  | "n"
  | "s"
  | "e"
  | "w"
  | "nw"
  | "ne"
  | "sw"
  | "se";

export const normalizeRotationDeg = (deg: number) => {
  if (!Number.isFinite(deg)) return 0;
  let next = deg % 360;
  if (next <= -180) next += 360;
  if (next > 180) next -= 360;
  return next;
};

export const normalizeRightAngleRotationDeg = (deg: number) => {
  const normalized = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
  return normalized === 360 ? 0 : normalized;
};

export const getWidgetRotationFromControlRotation = (
  pageRotationDeg: number,
  controlRotationDeg: number,
) =>
  normalizeRightAngleRotationDeg(
    normalizeRightAngleRotationDeg(pageRotationDeg) -
      normalizeRightAngleRotationDeg(controlRotationDeg),
  );

export const getControlRotationFromWidgetRotation = (
  pageRotationDeg: number,
  widgetRotationDeg: number,
) =>
  normalizeRightAngleRotationDeg(
    normalizeRightAngleRotationDeg(pageRotationDeg) -
      normalizeRightAngleRotationDeg(widgetRotationDeg),
  );

export const getRotatedOuterRect = (
  rect: RotationRect,
  rotationDeg: number,
): RotationRect => {
  const theta = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const absCos = Math.abs(cos);
  const absSin = Math.abs(sin);

  const outerW = absCos * rect.width + absSin * rect.height;
  const outerH = absSin * rect.width + absCos * rect.height;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;

  return {
    x: cx - outerW / 2,
    y: cy - outerH / 2,
    width: outerW,
    height: outerH,
  };
};

export const getRotationAxes = (rotationDeg: number) => {
  const theta = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  return {
    xAxis: { x: cos, y: sin },
    yAxis: { x: -sin, y: cos },
  };
};

const isResizeHandle = (handle: string): handle is RotationResizeHandle =>
  handle === "n" ||
  handle === "s" ||
  handle === "e" ||
  handle === "w" ||
  handle === "nw" ||
  handle === "ne" ||
  handle === "sw" ||
  handle === "se";

export const getResizeCursorForHandle = (
  handle: string,
  rotationDeg: number,
) => {
  if (!isResizeHandle(handle)) {
    return handle === "rotate" ? "grab" : "default";
  }

  const handleAngleDeg = (() => {
    switch (handle) {
      case "e":
        return 0;
      case "ne":
        return 45;
      case "n":
        return 90;
      case "nw":
        return 135;
      case "w":
        return 180;
      case "sw":
        return 225;
      case "s":
        return 270;
      case "se":
        return 315;
    }
  })();

  const snapped =
    (((Math.round((handleAngleDeg + rotationDeg) / 45) * 45) % 360) + 360) %
    360;

  if (snapped === 0 || snapped === 180) return "ns-resize";
  if (snapped === 90 || snapped === 270) return "ew-resize";
  if (snapped === 45 || snapped === 225) return "nesw-resize";
  return "nwse-resize";
};

export const getRotatedRectHandlePoint = (
  rect: RotationRect,
  rotationDeg: number,
  handle: "nw" | "ne" | "sw" | "se",
): RotationPoint => {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const { xAxis, yAxis } = getRotationAxes(rotationDeg);
  const xSign = handle.includes("e") ? 1 : -1;
  const ySign = handle.includes("s") ? 1 : -1;
  const dx = (rect.width / 2) * xSign;
  const dy = (rect.height / 2) * ySign;

  return {
    x: cx + dx * xAxis.x + dy * yAxis.x,
    y: cy + dx * xAxis.y + dy * yAxis.y,
  };
};

const clampRotatedResizeSize = (options: {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  aspectRatio?: number;
  originalWidth: number;
  originalHeight: number;
}) => {
  let width = Math.max(options.minWidth, options.width);
  let height = Math.max(options.minHeight, options.height);

  if (
    typeof options.aspectRatio === "number" &&
    Number.isFinite(options.aspectRatio) &&
    options.aspectRatio > 0
  ) {
    const widthDelta = Math.abs(width - options.originalWidth);
    const heightDelta = Math.abs(height - options.originalHeight);

    if (widthDelta > heightDelta * options.aspectRatio) {
      height = width / options.aspectRatio;
    } else {
      width = height * options.aspectRatio;
    }

    if (width < options.minWidth) {
      width = options.minWidth;
      height = width / options.aspectRatio;
    }
    if (height < options.minHeight) {
      height = options.minHeight;
      width = height * options.aspectRatio;
    }
  }

  return { width, height };
};

export const resizeRectFromRotatedHandle = (options: {
  rect: RotationRect;
  rotationDeg: number;
  handle: "nw" | "ne" | "sw" | "se";
  pointer: RotationPoint;
  minWidth?: number;
  minHeight?: number;
  aspectRatio?: number;
}): RotationRect => {
  const {
    rect,
    rotationDeg,
    handle,
    pointer,
    minWidth = 5,
    minHeight = 5,
    aspectRatio,
  } = options;
  const { xAxis, yAxis } = getRotationAxes(rotationDeg);
  const xSign = handle.includes("e") ? 1 : -1;
  const ySign = handle.includes("s") ? 1 : -1;
  const oppositeHandle =
    handle === "nw"
      ? "se"
      : handle === "ne"
        ? "sw"
        : handle === "sw"
          ? "ne"
          : "nw";
  const fixedCorner = getRotatedRectHandlePoint(
    rect,
    rotationDeg,
    oppositeHandle,
  );
  const delta = {
    x: pointer.x - fixedCorner.x,
    y: pointer.y - fixedCorner.y,
  };
  const projectedX = delta.x * xAxis.x + delta.y * xAxis.y;
  const projectedY = delta.x * yAxis.x + delta.y * yAxis.y;
  const nextSize = clampRotatedResizeSize({
    width: xSign * projectedX,
    height: ySign * projectedY,
    minWidth,
    minHeight,
    aspectRatio,
    originalWidth: rect.width,
    originalHeight: rect.height,
  });
  const nextCenter = {
    x:
      fixedCorner.x +
      (xSign * nextSize.width * xAxis.x + ySign * nextSize.height * yAxis.x) /
        2,
    y:
      fixedCorner.y +
      (xSign * nextSize.width * xAxis.y + ySign * nextSize.height * yAxis.y) /
        2,
  };

  return {
    x: nextCenter.x - nextSize.width / 2,
    y: nextCenter.y - nextSize.height / 2,
    width: nextSize.width,
    height: nextSize.height,
  };
};

export const getInnerSizeFromOuterAabb = (
  outer: Pick<RotationRect, "width" | "height">,
  rotationDeg: number,
) => {
  if (!Number.isFinite(rotationDeg) || rotationDeg === 0) {
    return { width: outer.width, height: outer.height };
  }

  const theta = (rotationDeg * Math.PI) / 180;
  const absCos = Math.abs(Math.cos(theta));
  const absSin = Math.abs(Math.sin(theta));
  const det = absCos * absCos - absSin * absSin;

  if (!Number.isFinite(det) || Math.abs(det) < 1e-6) {
    return { width: outer.width, height: outer.height };
  }

  const width = (outer.width * absCos - outer.height * absSin) / det;
  const height = (outer.height * absCos - outer.width * absSin) / det;

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return { width: outer.width, height: outer.height };
  }

  return { width, height };
};

export const rotateOuterRectKeepingCenter = (
  outerRect: RotationRect,
  fromRotationDeg: number,
  toRotationDeg: number,
): RotationRect => {
  const innerSize = getInnerSizeFromOuterAabb(outerRect, fromRotationDeg);
  const cx = outerRect.x + outerRect.width / 2;
  const cy = outerRect.y + outerRect.height / 2;

  return getRotatedOuterRect(
    {
      x: cx - innerSize.width / 2,
      y: cy - innerSize.height / 2,
      width: innerSize.width,
      height: innerSize.height,
    },
    toRotationDeg,
  );
};
