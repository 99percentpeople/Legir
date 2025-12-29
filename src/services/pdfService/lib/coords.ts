import { PDFPage } from "pdf-lib";
import type * as pdfjsLib from "pdfjs-dist";
import { pdfDebug } from "./debug";

const getViewportSummary = (viewport: pdfjsLib.PageViewport | undefined) => {
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

export const uiPointToPdfPoint = (
  page: PDFPage,
  point: { x: number; y: number },
  viewport?: pdfjsLib.PageViewport,
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
  viewport?: pdfjsLib.PageViewport,
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
  viewport?: pdfjsLib.PageViewport,
): [number, number, number, number] => {
  const b = uiRectToPdfBounds(page, rect, viewport);
  return [b.x, b.y, b.x + b.width, b.y + b.height];
};

export const pdfJsWidgetRectToUiRect = (
  rect: [number, number, number, number],
  viewport: pdfjsLib.PageViewport,
): { x: number; y: number; width: number; height: number } => {
  const [x1, y1, x2, y2] = rect;
  // Prefer pdf.js viewport conversion when available. This accounts for
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
  viewport: pdfjsLib.PageViewport,
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
