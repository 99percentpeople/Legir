import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFStream,
} from "@cantoo/pdf-lib";

export type PdfTransformMatrix = [
  number,
  number,
  number,
  number,
  number,
  number,
];

export type PdfRectTuple = [number, number, number, number];

type Point = { x: number; y: number };

const normalizeRotationDeg = (deg: number) => {
  if (!Number.isFinite(deg)) return 0;
  let next = deg % 360;
  if (next <= -180) next += 360;
  if (next > 180) next -= 360;
  return next;
};

const pdfFixedNumberTuple = <N extends 4 | 6>(
  obj: unknown,
  size: N,
): (N extends 4 ? PdfRectTuple : PdfTransformMatrix) | undefined => {
  if (!(obj instanceof PDFArray) || obj.size() < size) return undefined;
  const values: number[] = [];
  for (let index = 0; index < size; index++) {
    const entry = obj.lookup(index);
    if (!(entry instanceof PDFNumber)) return undefined;
    values.push(entry.asNumber());
  }

  if (values.some((value) => !Number.isFinite(value))) return undefined;
  return values as N extends 4 ? PdfRectTuple : PdfTransformMatrix;
};

export const pdfRectTupleFromObj = (obj: unknown) =>
  pdfFixedNumberTuple(obj, 4);

export const pdfTransformMatrixFromObj = (obj: unknown) =>
  pdfFixedNumberTuple(obj, 6);

export const getNormalAppearanceStream = (annot: PDFDict) => {
  const ap = annot.lookup(PDFName.of("AP"));
  if (!(ap instanceof PDFDict)) return undefined;

  const normal = ap.lookup(PDFName.of("N"));
  if (normal instanceof PDFStream) return normal;

  if (normal instanceof PDFDict) {
    for (const [key] of normal.entries()) {
      const candidate = normal.lookup(key);
      if (candidate instanceof PDFStream) return candidate;
    }
  }

  return undefined;
};

export const getAppearanceStreamMetadata = (annot: PDFDict) => {
  const stream = getNormalAppearanceStream(annot);
  if (!stream) {
    return {
      stream: undefined,
      bbox: undefined,
      matrix: undefined,
    };
  }

  return {
    stream,
    bbox: pdfRectTupleFromObj(stream.dict.lookup(PDFName.of("BBox"))),
    matrix: pdfTransformMatrixFromObj(stream.dict.lookup(PDFName.of("Matrix"))),
  };
};

export const getRotationDegFromPdfMatrix = (
  matrix: PdfTransformMatrix,
): number | undefined => {
  const [a, b, c, d] = matrix;
  const sx = Math.hypot(a, b);
  const sy = Math.hypot(c, d);

  if (
    (!Number.isFinite(sx) || sx < 1e-6) &&
    (!Number.isFinite(sy) || sy < 1e-6)
  ) {
    return undefined;
  }

  const radians =
    Number.isFinite(sx) && sx >= 1e-6 ? Math.atan2(b, a) : Math.atan2(-c, d);
  const deg = (radians * 180) / Math.PI;
  return Number.isFinite(deg) ? normalizeRotationDeg(deg) : undefined;
};

export const parseRotationDegFromAppearanceContent = (content: string) => {
  let rotation: number | undefined = undefined;
  const matches = content.matchAll(
    /([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+cm/g,
  );

  for (const match of matches) {
    const values = match
      .slice(1, 7)
      .map((value) => Number.parseFloat(value ?? ""));
    if (values.some((value) => !Number.isFinite(value))) continue;

    const matrix = values as PdfTransformMatrix;
    const deg = getRotationDegFromPdfMatrix(matrix);
    if (typeof deg !== "number") continue;

    const [a, b, c, d] = matrix;
    const sx = Math.hypot(a, b);
    const sy = Math.hypot(c, d);
    const orthogonality = Math.abs(a * c + b * d);
    const tolerance = Math.max(sx, sy, 1) * 1e-3;
    if (orthogonality > tolerance) continue;

    if (Math.abs(deg) < 1e-3) continue;
    rotation = deg;
  }

  return rotation;
};

export const buildPdfRotationMatrix = (
  rotationDeg: number,
  center: Point,
): PdfTransformMatrix => {
  const theta = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const tx = center.x - cos * center.x + sin * center.y;
  const ty = center.y - sin * center.x - cos * center.y;
  return [cos, sin, -sin, cos, tx, ty];
};

export const applyPdfMatrixToPoint = (
  matrix: PdfTransformMatrix,
  point: Point,
): Point => {
  const [a, b, c, d, e, f] = matrix;
  return {
    x: a * point.x + c * point.y + e,
    y: b * point.x + d * point.y + f,
  };
};

export const getTransformedPdfRect = (
  rect: PdfRectTuple,
  matrix: PdfTransformMatrix,
): PdfRectTuple => {
  const [x1, y1, x2, y2] = rect;
  const corners = [
    applyPdfMatrixToPoint(matrix, { x: x1, y: y1 }),
    applyPdfMatrixToPoint(matrix, { x: x1, y: y2 }),
    applyPdfMatrixToPoint(matrix, { x: x2, y: y1 }),
    applyPdfMatrixToPoint(matrix, { x: x2, y: y2 }),
  ];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of corners) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return [minX, minY, maxX, maxY];
};
