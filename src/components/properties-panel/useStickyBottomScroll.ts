import React from "react";

interface StickyBottomScrollOptions {
  enabled?: boolean;
  threshold?: number;
  settleFrames?: number;
}

export const useStickyBottomScroll = (
  containerRef: React.RefObject<HTMLElement | null>,
  options: StickyBottomScrollOptions = {},
) => {
  const { enabled = true, threshold = 96, settleFrames = 1 } = options;
  const isNearBottomRef = React.useRef(true);
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
      if (!force && !isNearBottomRef.current) return;

      cancelScheduledScroll();

      let remainingFrames = Math.max(1, settleFrames);
      const tick = () => {
        if (remainingFrames > 1) {
          remainingFrames -= 1;
          scrollRafRef.current = requestAnimationFrame(tick);
          return;
        }

        element.scrollTop = element.scrollHeight;
        isNearBottomRef.current = true;
        scrollRafRef.current = null;
      };

      scrollRafRef.current = requestAnimationFrame(tick);
    },
    [cancelScheduledScroll, containerRef, settleFrames],
  );

  React.useEffect(() => {
    if (!enabled) {
      cancelScheduledScroll();
      return;
    }

    const element = containerRef.current;
    if (!element) return;

    const updateNearBottom = () => {
      const distance =
        element.scrollHeight - (element.scrollTop + element.clientHeight);
      isNearBottomRef.current = distance < threshold;
    };

    updateNearBottom();
    element.addEventListener("scroll", updateNearBottom, { passive: true });

    return () => {
      element.removeEventListener("scroll", updateNearBottom);
    };
  }, [cancelScheduledScroll, containerRef, enabled, threshold]);

  React.useEffect(() => cancelScheduledScroll, [cancelScheduledScroll]);

  return {
    isNearBottomRef,
    scrollToBottom,
  };
};
