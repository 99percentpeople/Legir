import { useEffect, useRef } from "react";
import { useEventListener } from "@/hooks/useEventListener";

interface AutoScrollOptions {
  threshold?: number; // Distance from edge in pixels to trigger scroll
  speed?: number; // Max scroll speed in pixels per frame
  enabled?: boolean; // Whether auto-scroll is active
}

/**
 * Hook to automatically scroll a container when the pointer is near its edges.
 * Useful for drag-and-drop or resizing operations that need to extend beyond the current viewport.
 */
export const useAutoScroll = (
  containerRef: React.RefObject<HTMLElement>,
  options: AutoScrollOptions = {},
) => {
  const { threshold = 50, speed = 20, enabled = false } = options;
  const requestRef = useRef<number | null>(null);
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);

  useEventListener<PointerEvent>(
    enabled && typeof window !== "undefined" ? window : null,
    "pointermove",
    (e) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };
    },
  );

  // Animation loop
  useEffect(() => {
    if (!enabled) {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
      return;
    }

    const scroll = () => {
      const container = containerRef.current;
      const mousePos = mousePosRef.current;

      if (container && mousePos) {
        const rect = container.getBoundingClientRect();
        let dx = 0;
        let dy = 0;

        // Calculate intensity based on distance from edge (0 to 1)
        // Horizontal
        if (mousePos.x < rect.left + threshold) {
          const intensity = Math.min(
            1,
            (rect.left + threshold - mousePos.x) / threshold,
          );
          dx = -speed * intensity;
        } else if (mousePos.x > rect.right - threshold) {
          const intensity = Math.min(
            1,
            (mousePos.x - (rect.right - threshold)) / threshold,
          );
          dx = speed * intensity;
        }

        // Vertical
        if (mousePos.y < rect.top + threshold) {
          const intensity = Math.min(
            1,
            (rect.top + threshold - mousePos.y) / threshold,
          );
          dy = -speed * intensity;
        } else if (mousePos.y > rect.bottom - threshold) {
          const intensity = Math.min(
            1,
            (mousePos.y - (rect.bottom - threshold)) / threshold,
          );
          dy = speed * intensity;
        }

        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          container.scrollLeft += dx;
          container.scrollTop += dy;
        }
      }
      requestRef.current = requestAnimationFrame(scroll);
    };

    requestRef.current = requestAnimationFrame(scroll);

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [enabled, threshold, speed, containerRef]);
};
