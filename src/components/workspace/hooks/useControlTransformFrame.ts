import { useEffect, useMemo, useRef } from "react";

type PointerPosition = { x: number; y: number };

/** Only transforms may discard intermediate pointer samples. Drawing/eraser
 * input stays on its own path. Flush before release, cancel on tool exit. */
export function useControlTransformFrame(
  update: (point: PointerPosition) => void,
) {
  const updateRef = useRef(update);
  updateRef.current = update;
  const task = useMemo(() => {
    let frame: number | null = null;
    let pending: PointerPosition | null = null;
    const cancel = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      pending = null;
    };
    const flush = () => {
      const point = pending;
      cancel();
      if (point) updateRef.current(point);
    };
    return {
      queue: (x: number, y: number) => {
        pending = { x, y };
        frame ??= requestAnimationFrame(flush);
      },
      flush,
      cancel,
    };
  }, []);
  useEffect(() => task.cancel, [task]);
  return task;
}
