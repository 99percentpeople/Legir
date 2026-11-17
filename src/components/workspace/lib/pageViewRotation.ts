import type { PageData } from "@/types";
import {
  getEditedPage,
  getPageGeometryMatrix,
  transformPagePoint,
  inversePagePoint,
} from "@legir/pdf-model/pageGeometry";

type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };
type PageSize = Pick<
  PageData,
  "width" | "height" | "rotationDelta" | "geometry"
>;
export const getPageDisplayRotation = (
  page: Pick<PageData, "rotationDelta">,
  rotation: number,
) => ((page.rotationDelta ?? 0) + rotation + 360) % 360;

// View-only rotation is relative to the source viewport (including its /Rotate).
// Stored control geometry and PDF export always keep using that source viewport.
export const getPageView = (page: PageData, rotation: number): PageData => {
  rotation = getPageDisplayRotation(page, rotation);
  page = getEditedPage(page);
  if (!rotation) return page;
  const swap = rotation === 90 || rotation === 270;
  return {
    ...page,
    width: swap ? page.height : page.width,
    height: swap ? page.width : page.height,
    rotation: (page.rotation + rotation) % 360,
  };
};

export const pagePointToView = (
  point: Point,
  page: PageSize,
  rotation: number,
): Point => {
  return transformPagePoint(
    point,
    getPageGeometryMatrix(page, getPageDisplayRotation(page, rotation)),
  );
};

export const viewPointToPage = (
  point: Point,
  page: PageSize,
  rotation: number,
): Point => {
  return inversePagePoint(
    point,
    getPageGeometryMatrix(page, getPageDisplayRotation(page, rotation)),
  );
};

export const viewRectToPage = (
  rect: Rect,
  page: PageSize,
  rotation: number,
): Rect => {
  const a = viewPointToPage(rect, page, rotation);
  const b = viewPointToPage(
    { x: rect.x + rect.width, y: rect.y + rect.height },
    page,
    rotation,
  );
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
};

export const getPageOverlayTransform = (
  page: PageSize,
  rotation: number,
  scale: number,
) => {
  const angle = getPageDisplayRotation(page, rotation);
  if (!page.geometry) {
    const origin = pagePointToView({ x: 0, y: 0 }, page, rotation);
    return angle
      ? `translate(${origin.x * scale}px, ${origin.y * scale}px) rotate(${angle}deg)`
      : undefined;
  }
  const m = getPageGeometryMatrix(page, angle);
  return `matrix(${m[0]}, ${m[1]}, ${m[2]}, ${m[3]}, ${m[4] * scale}, ${m[5] * scale})`;
};
