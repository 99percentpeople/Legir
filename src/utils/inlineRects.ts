export type InlineRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type MergeInlineRectsOptions = {
  lineTolerance?: number;
  centerToleranceRatio?: number;
  minGapTolerance?: number;
  gapToleranceRatio?: number;
  maxGapTolerance?: number;
  dedupePrecision?: number;
};

type ResolvedMergeOptions = Required<MergeInlineRectsOptions>;

const DEFAULT_MERGE_OPTIONS: ResolvedMergeOptions = {
  lineTolerance: 2,
  centerToleranceRatio: 0.75,
  minGapTolerance: 4,
  gapToleranceRatio: 1.2,
  maxGapTolerance: 18,
  dedupePrecision: 0.5,
};

const resolveOptions = (
  options?: MergeInlineRectsOptions,
): ResolvedMergeOptions => ({
  ...DEFAULT_MERGE_OPTIONS,
  ...options,
});

const isValidRect = (rect: InlineRect) =>
  Number.isFinite(rect.x) &&
  Number.isFinite(rect.y) &&
  Number.isFinite(rect.width) &&
  Number.isFinite(rect.height) &&
  rect.width > 0 &&
  rect.height > 0;

const rectRight = (rect: InlineRect) => rect.x + rect.width;
const rectBottom = (rect: InlineRect) => rect.y + rect.height;
const rectCenterY = (rect: InlineRect) => rect.y + rect.height / 2;

const areOnSameLine = (
  a: InlineRect,
  b: InlineRect,
  options: ResolvedMergeOptions,
) => {
  const minHeight = Math.max(1, Math.min(a.height, b.height));
  const centerDiff = Math.abs(rectCenterY(a) - rectCenterY(b));

  return (
    centerDiff <=
    Math.max(options.lineTolerance, minHeight * options.centerToleranceRatio)
  );
};

const getGapTolerance = (
  a: InlineRect,
  b: InlineRect,
  options: ResolvedMergeOptions,
) =>
  Math.min(
    options.maxGapTolerance,
    Math.max(
      options.minGapTolerance,
      Math.max(a.height, b.height) * options.gapToleranceRatio,
    ),
  );

const sortInlineRects = (rects: InlineRect[], options: ResolvedMergeOptions) =>
  [...rects].sort((a, b) => {
    if (areOnSameLine(a, b, options)) return a.x - b.x;
    return rectCenterY(a) - rectCenterY(b);
  });

const getDedupeKey = (rect: InlineRect, precision: number) => {
  const snap = (value: number) => Math.round(value / precision);
  return `${snap(rect.x)}:${snap(rect.y)}:${snap(rect.width)}:${snap(rect.height)}`;
};

const dedupeInlineRects = (
  rects: InlineRect[],
  options: ResolvedMergeOptions,
) => {
  const seen = new Set<string>();
  const deduped: InlineRect[] = [];

  for (const rect of rects) {
    if (!isValidRect(rect)) continue;
    const key = getDedupeKey(rect, options.dedupePrecision);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...rect });
  }

  return deduped;
};

const canMergeInlineRects = (
  current: InlineRect,
  next: InlineRect,
  options: ResolvedMergeOptions,
) => {
  if (!areOnSameLine(current, next, options)) return false;
  const gap = next.x - rectRight(current);
  return gap <= getGapTolerance(current, next, options);
};

export const getInlineRectBounds = (rects: InlineRect[]) => {
  const validRects = rects.filter(isValidRect);
  if (validRects.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const rect of validRects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rectRight(rect));
    maxY = Math.max(maxY, rectBottom(rect));
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
};

export const mergeInlineRects = (
  rects: InlineRect[],
  options?: MergeInlineRectsOptions,
) => {
  const resolvedOptions = resolveOptions(options);
  const deduped = dedupeInlineRects(rects, resolvedOptions);
  if (deduped.length <= 1) return deduped;

  const merged: InlineRect[] = [];

  for (const rect of sortInlineRects(deduped, resolvedOptions)) {
    const current = merged[merged.length - 1];
    if (!current || !canMergeInlineRects(current, rect, resolvedOptions)) {
      merged.push({ ...rect });
      continue;
    }

    const right = Math.max(rectRight(current), rectRight(rect));
    const bottom = Math.max(rectBottom(current), rectBottom(rect));

    current.x = Math.min(current.x, rect.x);
    current.y = Math.min(current.y, rect.y);
    current.width = right - current.x;
    current.height = bottom - current.y;
  }

  return merged;
};
