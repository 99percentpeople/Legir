import { useEffect, useRef } from "react";

export const useWorkspaceInitialScroll = (opts: {
  containerRef: React.RefObject<HTMLElement | null>;
  initialScrollPosition?: { left: number; top: number } | null;
  scale: number;
  pagesLength: number;
  onInitialScrollApplied?: () => void;
}) => {
  const initialScrollRafRef = useRef<number | null>(null);
  const initialScrollKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!opts.initialScrollPosition) return;

    const targetLeft = Math.max(0, opts.initialScrollPosition.left);
    const targetTop = Math.max(0, opts.initialScrollPosition.top);
    const key = `${targetLeft}:${targetTop}:${opts.scale}:${opts.pagesLength}`;
    if (initialScrollKeyRef.current === key) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 120;

    const scheduleNext = () => {
      attempts += 1;
      if (attempts >= maxAttempts) {
        initialScrollKeyRef.current = key;
        opts.onInitialScrollApplied?.();
        return;
      }
      if (typeof window === "undefined") return;
      initialScrollRafRef.current = window.requestAnimationFrame(applyScroll);
    };

    const applyScroll = () => {
      if (cancelled) return;
      const el = opts.containerRef.current;
      if (!el) {
        scheduleNext();
        return;
      }

      const canReachX =
        targetLeft <= 0 || el.scrollWidth - el.clientWidth >= targetLeft - 1;
      const canReachY =
        targetTop <= 0 || el.scrollHeight - el.clientHeight >= targetTop - 1;

      if (!canReachX || !canReachY) {
        scheduleNext();
        return;
      }

      el.scrollLeft = targetLeft;
      el.scrollTop = targetTop;

      const leftOk =
        targetLeft <= 0 || Math.abs(el.scrollLeft - targetLeft) < 1;
      const topOk = targetTop <= 0 || Math.abs(el.scrollTop - targetTop) < 1;

      if (leftOk && topOk) {
        initialScrollKeyRef.current = key;
        opts.onInitialScrollApplied?.();
        return;
      }

      scheduleNext();
    };

    if (initialScrollRafRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(initialScrollRafRef.current);
    }
    initialScrollRafRef.current = null;

    if (typeof window === "undefined") {
      applyScroll();
    } else {
      initialScrollRafRef.current = window.requestAnimationFrame(applyScroll);
    }

    return () => {
      cancelled = true;
      if (
        initialScrollRafRef.current !== null &&
        typeof window !== "undefined"
      ) {
        window.cancelAnimationFrame(initialScrollRafRef.current);
      }
      initialScrollRafRef.current = null;
    };
  }, [
    opts.containerRef,
    opts.initialScrollPosition,
    opts.onInitialScrollApplied,
    opts.pagesLength,
    opts.scale,
  ]);
};
