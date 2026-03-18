import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const DEFAULT_DEFERRED_RENDER_SCALE_DELAY_MS = 160;

type UseDeferredRenderScaleOptions = {
  identity: string;
  scale: number;
  immediate?: boolean;
  enabled?: boolean;
  delayMs?: number;
};

export const useDeferredRenderScale = ({
  identity,
  scale,
  immediate = false,
  enabled = true,
  delayMs = DEFAULT_DEFERRED_RENDER_SCALE_DELAY_MS,
}: UseDeferredRenderScaleOptions) => {
  const [renderScale, setRenderScale] = useState(scale);
  const timeoutRef = useRef<number | null>(null);
  const latestScaleRef = useRef(scale);

  latestScaleRef.current = scale;

  const clearPendingUpdate = useCallback(() => {
    if (typeof window === "undefined") return;
    if (timeoutRef.current === null) return;
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  useLayoutEffect(() => {
    clearPendingUpdate();
    setRenderScale(scale);
  }, [clearPendingUpdate, identity]);

  useEffect(() => {
    if (!enabled || immediate) {
      clearPendingUpdate();
      setRenderScale((prev) => (prev === scale ? prev : scale));
      return;
    }

    if (renderScale === scale) {
      clearPendingUpdate();
      return;
    }

    clearPendingUpdate();
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      setRenderScale((prev) =>
        prev === latestScaleRef.current ? prev : latestScaleRef.current,
      );
    }, delayMs);

    return clearPendingUpdate;
  }, [clearPendingUpdate, delayMs, enabled, immediate, renderScale, scale]);

  useEffect(() => {
    return clearPendingUpdate;
  }, [clearPendingUpdate]);

  return renderScale;
};
