import { PDFName, PDFNumber, PDFPage } from "@cantoo/pdf-lib";
import type { ViewportLike } from "../types";
import { pdfDebug } from "./debug";

const getViewportSummary = (viewport: ViewportLike | undefined) => {
  try {
    return {
      width: viewport?.width,
      height: viewport?.height,
      scale: viewport?.scale,
      rotation: viewport?.rotation,
      transform: viewport?.transform,
      offsetX: viewport?.offsetX,
      offsetY: viewport?.offsetY,
    };
  } catch {
    return {};
  }
};

const applyTransform = (
  point: [number, number],
  transform: [number, number, number, number, number, number],
): [number, number] => {
  const [x, y] = point;
  return [
    x * transform[0] + y * transform[2] + transform[4],
    x * transform[1] + y * transform[3] + transform[5],
  ];
};

const applyInverseTransform = (
  point: [number, number],
  transform: [number, number, number, number, number, number],
): [number, number] => {
  const [x, y] = point;
  const [a, b, c, d, e, f] = transform;
  const det = a * d - b * c;
  return [
    (x * d - y * c + c * f - e * d) / det,
    (-x * b + y * a + e * b - f * a) / det,
  ];
};

export type PageViewportInfo = {
  viewBox: [number, number, number, number];
  userUnit?: number;
  rotation?: number;
};

export const getPdfLibPageInfo = (page: PDFPage): PageViewportInfo => {
  const crop = page.getCropBox();
  const viewBox: [number, number, number, number] = [
    crop.x,
    crop.y,
    crop.x + crop.width,
    crop.y + crop.height,
  ];

  let userUnit = 1;
  try {
    const userUnitObj = page.node.lookup(PDFName.of("UserUnit"));
    if (userUnitObj instanceof PDFNumber) {
      const v = userUnitObj.asNumber();
      if (Number.isFinite(v) && v > 0) userUnit = v;
    }
  } catch {
    // ignore
  }

  return {
    viewBox,
    userUnit,
    rotation: page.getRotation().angle,
  };
};

export const createViewportFromPageInfo = (
  pageInfo: PageViewportInfo,
  options?: {
    scale?: number;
    rotation?: number;
    offsetX?: number;
    offsetY?: number;
    dontFlip?: boolean;
  },
): ViewportLike => {
  const viewBox = pageInfo.viewBox;
  const resolvedUserUnit =
    typeof pageInfo.userUnit === "number" && pageInfo.userUnit > 0
      ? pageInfo.userUnit
      : 1;

  const scale = options?.scale ?? 1;
  const offsetX = options?.offsetX ?? 0;
  const offsetY = options?.offsetY ?? 0;
  const dontFlip = options?.dontFlip ?? false;
  let rotation = options?.rotation ?? pageInfo.rotation ?? 0;

  const centerX = (viewBox[2] + viewBox[0]) / 2;
  const centerY = (viewBox[3] + viewBox[1]) / 2;

  rotation %= 360;
  if (rotation < 0) rotation += 360;

  let rotateA: number;
  let rotateB: number;
  let rotateC: number;
  let rotateD: number;

  switch (rotation) {
    case 180:
      rotateA = -1;
      rotateB = 0;
      rotateC = 0;
      rotateD = 1;
      break;
    case 90:
      rotateA = 0;
      rotateB = 1;
      rotateC = 1;
      rotateD = 0;
      break;
    case 270:
      rotateA = 0;
      rotateB = -1;
      rotateC = -1;
      rotateD = 0;
      break;
    case 0:
      rotateA = 1;
      rotateB = 0;
      rotateC = 0;
      rotateD = -1;
      break;
    default:
      throw new Error(
        "createPdfLibViewport: rotation must be a multiple of 90 degrees",
      );
  }

  if (dontFlip) {
    rotateC = -rotateC;
    rotateD = -rotateD;
  }

  const finalScale = scale * resolvedUserUnit;

  let offsetCanvasX: number;
  let offsetCanvasY: number;
  let width: number;
  let height: number;

  if (rotateA === 0) {
    offsetCanvasX = Math.abs(centerY - viewBox[1]) * finalScale + offsetX;
    offsetCanvasY = Math.abs(centerX - viewBox[0]) * finalScale + offsetY;
    width = (viewBox[3] - viewBox[1]) * finalScale;
    height = (viewBox[2] - viewBox[0]) * finalScale;
  } else {
    offsetCanvasX = Math.abs(centerX - viewBox[0]) * finalScale + offsetX;
    offsetCanvasY = Math.abs(centerY - viewBox[1]) * finalScale + offsetY;
    width = (viewBox[2] - viewBox[0]) * finalScale;
    height = (viewBox[3] - viewBox[1]) * finalScale;
  }

  const transform: [number, number, number, number, number, number] = [
    rotateA * finalScale,
    rotateB * finalScale,
    rotateC * finalScale,
    rotateD * finalScale,
    offsetCanvasX -
      rotateA * finalScale * centerX -
      rotateC * finalScale * centerY,
    offsetCanvasY -
      rotateB * finalScale * centerX -
      rotateD * finalScale * centerY,
  ];

  return {
    viewBox,
    userUnit: resolvedUserUnit,
    scale,
    rotation,
    offsetX,
    offsetY,
    width,
    height,
    transform,
    convertToViewportPoint: (x, y) => applyTransform([x, y], transform),
    convertToPdfPoint: (x, y) => applyInverseTransform([x, y], transform),
  };
};

export const createPdfLibViewport = (
  page: PDFPage,
  options?: {
    scale?: number;
    rotation?: number;
    offsetX?: number;
    offsetY?: number;
    dontFlip?: boolean;
  },
): ViewportLike => {
  const pageInfo = getPdfLibPageInfo(page);
  return createViewportFromPageInfo(pageInfo, options);
};

export const uiPointToPdfPoint = (
  page: PDFPage,
  point: { x: number; y: number },
  viewport?: ViewportLike,
): { x: number; y: number } => {
  if (viewport && typeof viewport.convertToPdfPoint === "function") {
    const [x, y] = viewport.convertToPdfPoint(point.x, point.y);
    return { x, y };
  }

  // Fallback assumes viewport is unrotated and uses top-left UI origin.
  const { height: H } = page.getSize();
  return { x: point.x, y: H - point.y };
};

export const uiRectToPdfBounds = (
  page: PDFPage,
  rect: { x: number; y: number; width: number; height: number },
  viewport?: ViewportLike,
): { x: number; y: number; width: number; height: number } => {
  const p1 = uiPointToPdfPoint(page, { x: rect.x, y: rect.y }, viewport);
  const p2 = uiPointToPdfPoint(
    page,
    { x: rect.x + rect.width, y: rect.y },
    viewport,
  );
  const p3 = uiPointToPdfPoint(
    page,
    { x: rect.x, y: rect.y + rect.height },
    viewport,
  );
  const p4 = uiPointToPdfPoint(
    page,
    { x: rect.x + rect.width, y: rect.y + rect.height },
    viewport,
  );

  const minX = Math.min(p1.x, p2.x, p3.x, p4.x);
  const maxX = Math.max(p1.x, p2.x, p3.x, p4.x);
  const minY = Math.min(p1.y, p2.y, p3.y, p4.y);
  const maxY = Math.max(p1.y, p2.y, p3.y, p4.y);

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

export const uiRectToPdfAnnotRect = (
  page: PDFPage,
  rect: { x: number; y: number; width: number; height: number },
  viewport?: ViewportLike,
): [number, number, number, number] => {
  const b = uiRectToPdfBounds(page, rect, viewport);
  return [b.x, b.y, b.x + b.width, b.y + b.height];
};

export const pdfJsWidgetRectToUiRect = (
  rect: [number, number, number, number],
  viewport: ViewportLike,
): { x: number; y: number; width: number; height: number } => {
  const [x1, y1, x2, y2] = rect;
  // Prefer viewport conversion when available. This accounts for
  // cropBox/rotation/offset, and prevents systematic control offsets.
  if (viewport && typeof viewport.convertToViewportPoint === "function") {
    const [vx1, vy1] = viewport.convertToViewportPoint(x1, y1);
    const [vx2, vy2] = viewport.convertToViewportPoint(x2, y2);
    const x = Math.min(vx1, vx2);
    const y = Math.min(vy1, vy2);
    const width = Math.abs(vx2 - vx1);
    const height = Math.abs(vy2 - vy1);
    pdfDebug("import:coords", "widget_rect_to_ui", () => ({
      rect,
      viewport: getViewportSummary(viewport),
      converted: { vx1, vy1, vx2, vy2 },
      out: { x, y, width, height },
      method: "convertToViewportPoint",
    }));
    return { x, y, width, height };
  }

  const width = x2 - x1;
  const height = y2 - y1;
  const x = x1;
  const y = viewport.height - y2;
  pdfDebug("import:coords", "widget_rect_to_ui", () => ({
    rect,
    viewport: getViewportSummary(viewport),
    out: { x, y, width, height },
    method: "height_flip_fallback",
  }));
  return { x, y, width, height };
};

export const pdfJsRectToUiRect = (
  rect: [number, number, number, number],
  viewport: ViewportLike,
): { x: number; y: number; width: number; height: number } => {
  const [x1, y1, x2, y2] = rect;
  const [vx1, vy1] = viewport.convertToViewportPoint(x1, y1);
  const [vx2, vy2] = viewport.convertToViewportPoint(x2, y2);

  const x = Math.min(vx1, vx2);
  const y = Math.min(vy1, vy2);
  const width = Math.abs(vx2 - vx1);
  const height = Math.abs(vy2 - vy1);

  pdfDebug("import:coords", "rect_to_ui", () => ({
    rect,
    viewport: getViewportSummary(viewport),
    converted: { vx1, vy1, vx2, vy2 },
    out: { x, y, width, height },
  }));

  return { x, y, width, height };
};
