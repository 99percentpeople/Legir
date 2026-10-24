import React from "react";
import { useEventListener } from "@/hooks/useEventListener";

export function useScrollbarWidthOffset(options: {
  scrollElement: HTMLElement | null;
  enabled?: boolean;
  axis?: "y" | "x";
  fallbackWidthPx?: number;
  observeMutations?: boolean;
}): {
  scrollbarWidthPx: number;
  hasScrollbar: boolean;
  remeasure: () => void;
} {
  const enabled = options.enabled ?? true;
  const axis = options.axis ?? "y";
  const fallbackWidthPx = options.fallbackWidthPx ?? 16;
  const observeMutations = options.observeMutations ?? true;

  const [scrollbarWidthPx, setScrollbarWidthPx] = React.useState(0);
  const [hasScrollbar, setHasScrollbar] = React.useState(false);
  const systemScrollbarWidthRef = React.useRef<number | null>(null);
  const measureRafRef = React.useRef<number | null>(null);

  const getSystemScrollbarWidthPx = React.useCallback(() => {
    if (systemScrollbarWidthRef.current !== null) {
      return systemScrollbarWidthRef.current;
    }
    if (typeof document === "undefined") return 0;
    if (!document.body) return 0;

    const el = document.createElement("div");
    el.style.width = "100px";
    el.style.height = "100px";
    el.style.overflow = "scroll";
    el.style.position = "absolute";
    el.style.top = "-9999px";
    el.style.left = "-9999px";
    document.body.appendChild(el);

    const w = el.offsetWidth - el.clientWidth;
    el.remove();
    // A zero width is a valid cached result for overlay scrollbars. Repeating
    // this DOM write/read for PDF canvas/text mutations forces full layouts.
    systemScrollbarWidthRef.current = Math.max(0, w);
    return systemScrollbarWidthRef.current;
  }, []);

  const measureScrollbarWidth = React.useCallback(() => {
    if (!enabled || !options.scrollElement) {
      setScrollbarWidthPx(0);
      setHasScrollbar(false);
      return;
    }

    const el = options.scrollElement;

    const has =
      axis === "y"
        ? el.scrollHeight > el.clientHeight
        : el.scrollWidth > el.clientWidth;
    setHasScrollbar(has);
    if (!has) {
      setScrollbarWidthPx(0);
      return;
    }

    const thickness =
      axis === "y"
        ? el.offsetWidth - el.clientWidth
        : el.offsetHeight - el.clientHeight;
    if (thickness > 0) {
      setScrollbarWidthPx(thickness);
      return;
    }

    // Overlay scrollbars (thickness = 0) still visually occupy the edge; reserve a typical width.
    const fallback = getSystemScrollbarWidthPx();
    setScrollbarWidthPx(fallback || fallbackWidthPx);
  }, [
    axis,
    enabled,
    fallbackWidthPx,
    getSystemScrollbarWidthPx,
    options.scrollElement,
  ]);

  const scheduleMeasurement = React.useCallback(() => {
    if (measureRafRef.current !== null) return;
    measureRafRef.current = requestAnimationFrame(() => {
      measureRafRef.current = null;
      measureScrollbarWidth();
    });
  }, [measureScrollbarWidth]);

  const handleWindowResize = React.useCallback(() => {
    // Browser zoom/display changes can change the system scrollbar width.
    systemScrollbarWidthRef.current = null;
    scheduleMeasurement();
  }, [scheduleMeasurement]);

  useEventListener(
    enabled && typeof window !== "undefined" ? window : null,
    "resize",
    handleWindowResize,
  );

  React.useEffect(() => {
    measureScrollbarWidth();

    let ro: ResizeObserver | null = null;
    if (
      enabled &&
      options.scrollElement &&
      typeof ResizeObserver !== "undefined"
    ) {
      ro = new ResizeObserver(scheduleMeasurement);
      ro.observe(options.scrollElement);
    }

    let mo: MutationObserver | null = null;
    if (
      enabled &&
      observeMutations &&
      options.scrollElement &&
      typeof MutationObserver !== "undefined"
    ) {
      // Canvas swaps, text-layer changes and page virtualization can publish
      // many mutations in one frame; read scroll geometry only once per frame.
      mo = new MutationObserver(scheduleMeasurement);
      mo.observe(options.scrollElement, {
        subtree: true,
        childList: true,
        attributes: true,
      });
    }

    return () => {
      ro?.disconnect();
      mo?.disconnect();
      if (measureRafRef.current !== null) {
        cancelAnimationFrame(measureRafRef.current);
        measureRafRef.current = null;
      }
    };
  }, [
    enabled,
    measureScrollbarWidth,
    observeMutations,
    options.scrollElement,
    scheduleMeasurement,
  ]);

  return { scrollbarWidthPx, hasScrollbar, remeasure: measureScrollbarWidth };
}
