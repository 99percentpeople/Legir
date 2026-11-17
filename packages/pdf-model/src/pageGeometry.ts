import type {
  PageData,
  PageGeometry,
  PageGeometryRect,
  PageResizeOptions,
  PageCropMargins,
} from "./types.js";

type Point = { x: number; y: number };
export type PageMatrix = [number, number, number, number, number, number];
export const normalizePageRotation = (rotation: number) =>
  ((rotation % 360) + 360) % 360;

export function getPageGeometry(
  page: Pick<PageData, "width" | "height" | "geometry">,
): PageGeometry {
  return (
    page.geometry ?? {
      box: { x: 0, y: 0, width: page.width, height: page.height },
      scale: 1,
    }
  );
}

export function assertPageGeometry(page: PageData, geometry: PageGeometry) {
  for (const box of [geometry.box, geometry.mediaBox].filter(
    (b): b is PageGeometryRect => !!b,
  )) {
    if (
      ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
      box.width <= 0 ||
      box.height <= 0
    )
      throw new Error("Invalid page geometry");
  }
  const unit = page.userUnit * geometry.scale;
  if (
    !Number.isFinite(unit) ||
    unit <= 0 ||
    unit > 75000 ||
    ![
      geometry.box.width * geometry.scale,
      geometry.box.height * geometry.scale,
    ].every((n) => n >= 1 && n <= 14400)
  )
    throw new Error("Invalid page dimensions");
  if (geometry.mediaBox) {
    const b = geometry.box,
      m = geometry.mediaBox;
    if (
      b.x < m.x - 1e-7 ||
      b.y < m.y - 1e-7 ||
      b.x + b.width > m.x + m.width + 1e-7 ||
      b.y + b.height > m.y + m.height + 1e-7
    )
      throw new Error("Crop exceeds paper boundary");
  }
}

/** Maps source display coordinates to the edited display, then rotates it. */
export function getPageGeometryMatrix(
  page: Pick<PageData, "width" | "height" | "geometry">,
  rotation = 0,
): PageMatrix {
  const { box: b, scale: s } = getPageGeometry(page);
  switch (normalizePageRotation(rotation)) {
    case 90:
      return [0, s, -s, 0, (b.y + b.height) * s, -b.x * s];
    case 180:
      return [-s, 0, 0, -s, (b.x + b.width) * s, (b.y + b.height) * s];
    case 270:
      return [0, -s, s, 0, -b.y * s, (b.x + b.width) * s];
    default:
      return [s, 0, 0, s, -b.x * s, -b.y * s];
  }
}
export function transformPagePoint(p: Point, m: PageMatrix): Point {
  return {
    x: p.x * m[0] + p.y * m[2] + m[4],
    y: p.x * m[1] + p.y * m[3] + m[5],
  };
}
export function inversePagePoint(p: Point, m: PageMatrix): Point {
  const d = m[0] * m[3] - m[1] * m[2];
  const x = p.x - m[4],
    y = p.y - m[5];
  return {
    x: (x * m[3] - y * m[2]) / d || 0,
    y: (y * m[0] - x * m[1]) / d || 0,
  };
}
export function sourceRectToPdfBox(
  page: PageData,
  rect: PageGeometryRect,
): PageData["viewBox"] {
  const [x0, y0, x1, y1] = page.viewBox,
    u = page.userUnit;
  const toPdf = ({ x, y }: Point): Point => {
    switch (normalizePageRotation(page.rotation)) {
      case 90:
        return { x: x0 + y / u, y: y0 + x / u };
      case 180:
        return { x: x1 - x / u, y: y0 + y / u };
      case 270:
        return { x: x1 - y / u, y: y1 - x / u };
      default:
        return { x: x0 + x / u, y: y1 - y / u };
    }
  };
  const a = toPdf(rect),
    b = toPdf({ x: rect.x + rect.width, y: rect.y + rect.height });
  return [
    Math.min(a.x, b.x),
    Math.min(a.y, b.y),
    Math.max(a.x, b.x),
    Math.max(a.y, b.y),
  ];
}

/** Effective viewport before saved/view-only rotation; source contracts stay intact. */
export function getEditedPage(page: PageData): PageData {
  if (!page.geometry) return page;
  const { box, scale } = page.geometry;
  return {
    ...page,
    geometry: undefined,
    width: box.width * scale,
    height: box.height * scale,
    viewBox: sourceRectToPdfBox(page, box),
    userUnit: page.userUnit * scale,
  };
}

export function resizePageGeometry(
  page: PageData,
  options: PageResizeOptions,
): PageGeometry {
  if (
    ![options.width, options.height].every(
      (n) => Number.isFinite(n) && n >= 1 && n <= 14400,
    ) ||
    ![0, 0.5, 1].includes(options.anchorX) ||
    ![0, 0.5, 1].includes(options.anchorY) ||
    !["original", "fit"].includes(options.content)
  )
    throw new Error("Invalid page dimensions");
  const current = getPageGeometry(page);
  const rotation = normalizePageRotation(page.rotationDelta ?? 0);
  const swap = rotation === 90 || rotation === 270;
  const width = swap ? options.height : options.width,
    height = swap ? options.width : options.height;
  const scale =
    options.content === "fit"
      ? Math.min(width / current.box.width, height / current.box.height)
      : current.scale;
  const anchor = inversePagePoint(
    { x: options.anchorX, y: options.anchorY },
    getPageGeometryMatrix(
      { ...page, width: 1, height: 1, geometry: undefined },
      rotation,
    ),
  );
  const box = {
    x: current.box.x - (width / scale - current.box.width) * anchor.x,
    y: current.box.y - (height / scale - current.box.height) * anchor.y,
    width: width / scale,
    height: height / scale,
  };
  const geometry = { box, scale, mediaBox: box };
  assertPageGeometry(page, geometry);
  return geometry;
}

export function cropPageGeometry(
  page: PageData,
  margins: PageCropMargins,
): PageGeometry {
  if (!Object.values(margins).every((n) => Number.isFinite(n) && n >= 0))
    throw new Error("Invalid crop margins");
  const current = getPageGeometry(page),
    rotation = normalizePageRotation(page.rotationDelta ?? 0);
  const swap = rotation === 90 || rotation === 270;
  const w = (swap ? current.box.height : current.box.width) * current.scale;
  const h = (swap ? current.box.width : current.box.height) * current.scale;
  if (
    w - margins.left - margins.right < 1 ||
    h - margins.top - margins.bottom < 1
  )
    throw new Error("Crop must leave a visible page");
  const m = getPageGeometryMatrix(page, rotation);
  const a = inversePagePoint({ x: margins.left, y: margins.top }, m);
  const b = inversePagePoint(
    { x: w - margins.right, y: h - margins.bottom },
    m,
  );
  const geometry = {
    ...current,
    box: {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    },
  };
  assertPageGeometry(page, geometry);
  return geometry;
}

export function resetPageCrop(page: PageData): PageGeometry | undefined {
  const g = page.geometry;
  if (g?.mediaBox) return { ...g, box: g.mediaBox };
  if (!page.sourceMediaBox) return undefined;
  const [x0, y0, x1, y1] = page.viewBox,
    u = page.userUnit;
  const point = (x: number, y: number): Point => {
    switch (normalizePageRotation(page.rotation)) {
      case 90:
        return { x: (y - y0) * u, y: (x - x0) * u };
      case 180:
        return { x: (x1 - x) * u, y: (y - y0) * u };
      case 270:
        return { x: (y1 - y) * u, y: (x1 - x) * u };
      default:
        return { x: (x - x0) * u, y: (y1 - y) * u };
    }
  };
  const a = point(page.sourceMediaBox[0], page.sourceMediaBox[1]);
  const b = point(page.sourceMediaBox[2], page.sourceMediaBox[3]);
  const geometry = {
    box: {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    },
    scale: g?.scale ?? 1,
  };
  assertPageGeometry(page, geometry);
  return geometry;
}
export const pageGeometryKey = (page: Pick<PageData, "geometry">) =>
  JSON.stringify(page.geometry ?? null);
