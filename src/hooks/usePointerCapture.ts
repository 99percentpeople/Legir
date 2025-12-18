import { useCallback, RefObject } from "react";

/**
 * Hook to manage pointer capture for an element.
 * Provides safe wrappers for setPointerCapture and releasePointerCapture.
 */
export const usePointerCapture = (ref: RefObject<HTMLElement>) => {
  /**
   * Captures the pointer to the referenced element.
   * Should be called in onPointerDown.
   */
  const capture = useCallback(
    (e: React.PointerEvent) => {
      if (ref.current) {
        ref.current.setPointerCapture(e.pointerId);
      }
    },
    [ref],
  );

  /**
   * Releases the pointer capture from the referenced element.
   * Safe to call with MouseEvent or undefined (will do nothing).
   * Should be called in onPointerUp.
   */
  const release = useCallback(
    (e?: React.PointerEvent | React.MouseEvent | PointerEvent | Event) => {
      if (!e || !("pointerId" in e)) return;

      const pointerId = (e as React.PointerEvent).pointerId;
      if (ref.current && ref.current.hasPointerCapture(pointerId)) {
        ref.current.releasePointerCapture(pointerId);
      }
    },
    [ref],
  );

  return { capture, release };
};
