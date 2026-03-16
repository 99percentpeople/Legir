const AI_GEOMETRY_PRECISION = 2;

export const roundAiNumber = (
  value: number,
  fractionDigits = AI_GEOMETRY_PRECISION,
) => {
  if (!Number.isFinite(value)) return value;

  const rounded = Number(value.toFixed(fractionDigits));
  return Object.is(rounded, -0) ? 0 : rounded;
};

export const roundAiRect = <
  TRect extends { x: number; y: number; width: number; height: number },
>(
  rect: TRect,
): TRect => ({
  ...rect,
  x: roundAiNumber(rect.x),
  y: roundAiNumber(rect.y),
  width: roundAiNumber(rect.width),
  height: roundAiNumber(rect.height),
});
