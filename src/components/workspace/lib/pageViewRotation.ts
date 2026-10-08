import type { PageData } from "@/types";

type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };
type PageSize = Pick<PageData, "width" | "height">;

// View-only rotation is relative to the source viewport (including its /Rotate).
// Stored control geometry and PDF export always keep using that source viewport.
export const getPageView = (page: PageData, rotation: number): PageData => {
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
  switch (rotation) {
    case 90:
      return { x: page.height - point.y, y: point.x };
    case 180:
      return { x: page.width - point.x, y: page.height - point.y };
    case 270:
      return { x: point.y, y: page.width - point.x };
    default:
      return point;
  }
};

export const viewPointToPage = (
  point: Point,
  page: PageSize,
  rotation: number,
): Point => {
  switch (rotation) {
    case 90:
      return { x: point.y, y: page.height - point.x };
    case 180:
      return { x: page.width - point.x, y: page.height - point.y };
    case 270:
      return { x: page.width - point.y, y: point.x };
    default:
      return point;
  }
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
  const origin = pagePointToView({ x: 0, y: 0 }, page, rotation);
  return rotation
    ? `translate(${origin.x * scale}px, ${origin.y * scale}px) rotate(${rotation}deg)`
    : undefined;
};
