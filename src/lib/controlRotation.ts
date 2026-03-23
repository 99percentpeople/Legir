export type RotationRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

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
