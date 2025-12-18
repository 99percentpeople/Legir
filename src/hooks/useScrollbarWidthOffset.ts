import React from "react";

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

  const getSystemScrollbarWidthPx = React.useCallback(() => {
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
    return w > 0 ? w : 0;
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

  React.useEffect(() => {
    measureScrollbarWidth();

    if (typeof window !== "undefined") {
      window.addEventListener("resize", measureScrollbarWidth);
    }

    let ro: ResizeObserver | null = null;
    if (options.scrollElement && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => measureScrollbarWidth());
      ro.observe(options.scrollElement);
    }

    let mo: MutationObserver | null = null;
    if (
      observeMutations &&
      options.scrollElement &&
      typeof MutationObserver !== "undefined"
    ) {
      mo = new MutationObserver(() => measureScrollbarWidth());
      mo.observe(options.scrollElement, {
        subtree: true,
        childList: true,
        attributes: true,
      });
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", measureScrollbarWidth);
      }
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [measureScrollbarWidth, observeMutations, options.scrollElement]);

  return { scrollbarWidthPx, hasScrollbar, remeasure: measureScrollbarWidth };
}
