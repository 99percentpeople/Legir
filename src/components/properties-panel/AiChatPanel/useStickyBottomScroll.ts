import React from "react";
import { useEventListener } from "@/hooks/useEventListener";

const PASSIVE_SCROLL_OPTIONS = {
  passive: true,
} satisfies AddEventListenerOptions;

interface StickyBottomScrollOptions {
  enabled?: boolean;
  threshold?: number;
  settleFrames?: number;
}

export const useStickyBottomScroll = (
  containerRef: React.RefObject<HTMLElement | null>,
  options: StickyBottomScrollOptions = {},
) => {
  const { enabled = true, threshold = 4, settleFrames = 1 } = options;
  const [scrollTarget, setScrollTarget] = React.useState<HTMLElement | null>(
    null,
  );
  const shouldFollowBottomRef = React.useRef(true);
  const scrollRafRef = React.useRef<number | null>(null);

  const cancelScheduledScroll = React.useCallback(() => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  }, []);

  const scrollToBottom = React.useCallback(
    (force = false) => {
      const element = containerRef.current;
      if (!element) return;
      if (force) {
        shouldFollowBottomRef.current = true;
      }
      if (!force && !shouldFollowBottomRef.current) return;

      cancelScheduledScroll();

      let remainingFrames = Math.max(1, settleFrames);
      const tick = () => {
        if (remainingFrames > 1) {
          remainingFrames -= 1;
          scrollRafRef.current = requestAnimationFrame(tick);
          return;
        }

        element.scrollTop = element.scrollHeight;
        shouldFollowBottomRef.current = true;
        scrollRafRef.current = null;
      };

      scrollRafRef.current = requestAnimationFrame(tick);
    },
    [cancelScheduledScroll, containerRef, settleFrames],
  );

  const updateNearBottom = React.useCallback(() => {
    const element = scrollTarget;
    if (!element) return;
    const distance =
      element.scrollHeight - (element.scrollTop + element.clientHeight);
    const isNearBottom = distance < threshold;

    shouldFollowBottomRef.current = isNearBottom;
  }, [scrollTarget, threshold]);

  React.useEffect(() => {
    const nextTarget = enabled ? containerRef.current : null;
    setScrollTarget((currentTarget) =>
      currentTarget === nextTarget ? currentTarget : nextTarget,
    );

    if (!nextTarget) {
      cancelScheduledScroll();
      return;
    }

    const distance =
      nextTarget.scrollHeight -
      (nextTarget.scrollTop + nextTarget.clientHeight);
    shouldFollowBottomRef.current = distance < threshold;
  }, [cancelScheduledScroll, containerRef, enabled, threshold]);

  useEventListener<Event>(
    enabled ? scrollTarget : null,
    "scroll",
    updateNearBottom,
    PASSIVE_SCROLL_OPTIONS,
  );

  React.useEffect(() => cancelScheduledScroll, [cancelScheduledScroll]);

  return {
    scrollToBottom,
  };
};
