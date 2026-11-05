import { ZOOM_BASE } from "@/constants";

export type ZoomBounds = { minScale: number; maxScale: number };

export function clampViewportScale(scale: number, bounds: ZoomBounds) {
  return Math.max(bounds.minScale, Math.min(bounds.maxScale, scale));
}

export function normalizeViewportScale(scale: number, bounds: ZoomBounds) {
  return Number(clampViewportScale(scale, bounds).toFixed(3));
}

// One wheel notch and one double tap use the same zoom step. Trackpads and
// touch pinches retain fractional steps instead of snapping between presets.
export function stepViewportScale(scale: number, steps: number) {
  return scale * Math.pow(ZOOM_BASE, steps);
}

export function wheelViewportScale(
  scale: number,
  event: Pick<WheelEvent, "deltaY" | "deltaMode">,
  viewportHeight: number,
) {
  const pixels =
    event.deltaY *
    (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportHeight : 1);
  return stepViewportScale(scale, -pixels / 100);
}
