import React from "react";
import {
  type EventListenerSpec,
  useEventListeners,
} from "@/hooks/useEventListener";

const BOTTOM_THRESHOLD_PX = 64;
const USER_SCROLL_SETTLE_MS = 120;
const PROGRAMMATIC_SCROLL_GUARD_MS = 80;
const SCROLLBAR_HIT_TARGET_PX = 20;
const PANEL_BODY_SELECTOR = '[data-slot="panel-body"]';
const PASSIVE_SCROLL_OPTIONS = {
  passive: true,
} satisfies AddEventListenerOptions;
const USER_SCROLL_LISTENER_OPTIONS = {
  passive: true,
  capture: true,
} satisfies AddEventListenerOptions;

const timelineBodyStyle = {
  overflowAnchor: "none",
} satisfies React.CSSProperties;

const isScrollAtBottom = (element: HTMLElement) =>
  element.scrollHeight - (element.scrollTop + element.clientHeight) <=
  BOTTOM_THRESHOLD_PX;

const isBottomSentinelInRange = (
  scrollElement: HTMLElement,
  sentinelElement: HTMLElement,
) => {
  const scrollRect = scrollElement.getBoundingClientRect();
  const sentinelRect = sentinelElement.getBoundingClientRect();

  return sentinelRect.top <= scrollRect.bottom + BOTTOM_THRESHOLD_PX;
};

const getScrollContainer = (endElement: HTMLElement | null) =>
  endElement?.closest?.(PANEL_BODY_SELECTOR) as HTMLElement | null;

interface TimelineBottomScrollOptions {
  isOpen: boolean;
  hasItems: boolean;
}

export const useTimelineBottomScroll = ({
  isOpen,
  hasItems,
}: TimelineBottomScrollOptions) => {
  const endElementRef = React.useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = React.useRef<HTMLElement | null>(null);
  const [scrollTarget, setScrollTarget] = React.useState<HTMLElement | null>(
    null,
  );
  const shouldFollowBottomRef = React.useRef(true);
  const userDetachedFromBottomRef = React.useRef(false);
  const userScrollActiveRef = React.useRef(false);
  const programmaticScrollRef = React.useRef(false);
  const lastScrollTopRef = React.useRef(0);
  const touchYRef = React.useRef<number | null>(null);
  const scrollRafRef = React.useRef<number | null>(null);
  const userScrollSettleTimeoutRef = React.useRef<number | null>(null);
  const programmaticScrollTimeoutRef = React.useRef<number | null>(null);

  const cancelScheduledScroll = React.useCallback(() => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  }, []);

  const clearUserScrollSettleTimeout = React.useCallback(() => {
    if (userScrollSettleTimeoutRef.current !== null) {
      window.clearTimeout(userScrollSettleTimeoutRef.current);
      userScrollSettleTimeoutRef.current = null;
    }
  }, []);

  const clearProgrammaticScrollTimeout = React.useCallback(() => {
    if (programmaticScrollTimeoutRef.current !== null) {
      window.clearTimeout(programmaticScrollTimeoutRef.current);
      programmaticScrollTimeoutRef.current = null;
    }
  }, []);

  const setResolvedScrollTarget = React.useCallback(
    (nextTarget: HTMLElement | null) => {
      scrollContainerRef.current = nextTarget;
      setScrollTarget((currentTarget) =>
        currentTarget === nextTarget ? currentTarget : nextTarget,
      );
    },
    [],
  );

  const endRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      endElementRef.current = node;
      setResolvedScrollTarget(node ? getScrollContainer(node) : null);
    },
    [setResolvedScrollTarget],
  );

  const resolveScrollContainer = React.useCallback(() => {
    const scrollEl =
      scrollContainerRef.current ?? getScrollContainer(endElementRef.current);
    if (scrollEl) {
      scrollContainerRef.current = scrollEl;
    }
    return scrollEl;
  }, []);

  const setFollowBottom = React.useCallback((shouldFollow: boolean) => {
    shouldFollowBottomRef.current = shouldFollow;
    userDetachedFromBottomRef.current = !shouldFollow;
    if (shouldFollow) {
      userScrollActiveRef.current = false;
    }
  }, []);

  const scrollToBottom = React.useCallback(
    (force = false) => {
      if (!isOpen) return;
      if (force) {
        setFollowBottom(true);
        clearUserScrollSettleTimeout();
      }
      if (
        !force &&
        (userScrollActiveRef.current ||
          userDetachedFromBottomRef.current ||
          !shouldFollowBottomRef.current)
      ) {
        return;
      }

      const scrollEl = resolveScrollContainer();
      if (!scrollEl) return;

      cancelScheduledScroll();
      scrollRafRef.current = requestAnimationFrame(() => {
        if (
          !force &&
          (userScrollActiveRef.current ||
            userDetachedFromBottomRef.current ||
            !shouldFollowBottomRef.current)
        ) {
          scrollRafRef.current = null;
          return;
        }

        programmaticScrollRef.current = true;
        clearProgrammaticScrollTimeout();
        programmaticScrollTimeoutRef.current = window.setTimeout(() => {
          programmaticScrollRef.current = false;
          programmaticScrollTimeoutRef.current = null;
        }, PROGRAMMATIC_SCROLL_GUARD_MS);

        scrollEl.scrollTop = scrollEl.scrollHeight;

        setFollowBottom(true);
        lastScrollTopRef.current = scrollEl.scrollTop;
        scrollRafRef.current = null;
      });
    },
    [
      cancelScheduledScroll,
      clearProgrammaticScrollTimeout,
      clearUserScrollSettleTimeout,
      isOpen,
      resolveScrollContainer,
      setFollowBottom,
    ],
  );

  const isBottomInRange = React.useCallback(() => {
    const scrollEl = resolveScrollContainer();
    const endEl = endElementRef.current;
    if (!scrollEl || !endEl) return false;
    return (
      isBottomSentinelInRange(scrollEl, endEl) || isScrollAtBottom(scrollEl)
    );
  }, [resolveScrollContainer]);

  const applyFollowFromBottomRange = React.useCallback(() => {
    setFollowBottom(isBottomInRange());
  }, [isBottomInRange, setFollowBottom]);

  const settleUserScroll = React.useCallback(() => {
    clearUserScrollSettleTimeout();
    userScrollSettleTimeoutRef.current = window.setTimeout(() => {
      userScrollActiveRef.current = false;
      applyFollowFromBottomRange();
      userScrollSettleTimeoutRef.current = null;
    }, USER_SCROLL_SETTLE_MS);
  }, [applyFollowFromBottomRange, clearUserScrollSettleTimeout]);

  const beginUserScroll = React.useCallback(() => {
    userScrollActiveRef.current = true;
    programmaticScrollRef.current = false;
    clearProgrammaticScrollTimeout();
    cancelScheduledScroll();
    settleUserScroll();
  }, [cancelScheduledScroll, clearProgrammaticScrollTimeout, settleUserScroll]);

  const updateFollowFromScroll = React.useCallback(() => {
    const scrollEl = resolveScrollContainer();
    if (!scrollEl) return;

    const scrollTopChanged =
      Math.abs(scrollEl.scrollTop - lastScrollTopRef.current) > 1;
    lastScrollTopRef.current = scrollEl.scrollTop;

    if (programmaticScrollRef.current) {
      if (isBottomInRange()) {
        setFollowBottom(true);
      }
      return;
    }

    if (userScrollActiveRef.current) {
      settleUserScroll();
      return;
    }

    if (isBottomInRange()) {
      setFollowBottom(true);
      return;
    }

    if (!userDetachedFromBottomRef.current && scrollTopChanged) {
      setFollowBottom(false);
    }
  }, [
    isBottomInRange,
    resolveScrollContainer,
    setFollowBottom,
    settleUserScroll,
  ]);

  const handleWheel = React.useCallback(
    (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      beginUserScroll();
    },
    [beginUserScroll],
  );

  const handleTouchStart = React.useCallback((event: TouchEvent) => {
    touchYRef.current = event.touches[0]?.clientY ?? null;
  }, []);

  const handleTouchMove = React.useCallback(
    (event: TouchEvent) => {
      const previousY = touchYRef.current;
      const nextY = event.touches[0]?.clientY ?? null;
      if (
        previousY !== null &&
        nextY !== null &&
        Math.abs(nextY - previousY) > 2
      ) {
        beginUserScroll();
      }
      touchYRef.current = nextY;
    },
    [beginUserScroll],
  );

  const handlePointerDown = React.useCallback(
    (event: PointerEvent) => {
      const scrollEl = resolveScrollContainer();
      if (!scrollEl) return;
      const rect = scrollEl.getBoundingClientRect();
      if (event.clientX < rect.right - SCROLLBAR_HIT_TARGET_PX) return;
      beginUserScroll();
    },
    [beginUserScroll, resolveScrollContainer],
  );

  const restoreFollowIfBottom = React.useCallback(() => {
    if (!isBottomInRange()) return;
    if (userScrollActiveRef.current) return;
    setFollowBottom(true);
  }, [isBottomInRange, setFollowBottom]);

  const eventTarget = isOpen && hasItems ? scrollTarget : null;
  const timelineEventListeners = React.useMemo(
    () =>
      [
        {
          type: "scroll",
          handler: updateFollowFromScroll,
          options: PASSIVE_SCROLL_OPTIONS,
        },
        {
          type: "wheel",
          handler: (event) => handleWheel(event as WheelEvent),
          options: USER_SCROLL_LISTENER_OPTIONS,
        },
        {
          type: "touchstart",
          handler: (event) => handleTouchStart(event as TouchEvent),
          options: USER_SCROLL_LISTENER_OPTIONS,
        },
        {
          type: "touchmove",
          handler: (event) => handleTouchMove(event as TouchEvent),
          options: USER_SCROLL_LISTENER_OPTIONS,
        },
        {
          type: "pointerdown",
          handler: (event) => handlePointerDown(event as PointerEvent),
          options: USER_SCROLL_LISTENER_OPTIONS,
        },
      ] satisfies EventListenerSpec[],
    [
      handlePointerDown,
      handleTouchMove,
      handleTouchStart,
      handleWheel,
      updateFollowFromScroll,
    ],
  );

  useEventListeners(eventTarget, timelineEventListeners);

  React.useEffect(() => {
    return () => {
      clearUserScrollSettleTimeout();
      clearProgrammaticScrollTimeout();
    };
  }, [clearProgrammaticScrollTimeout, clearUserScrollSettleTimeout]);

  React.useEffect(() => cancelScheduledScroll, [cancelScheduledScroll]);

  React.useEffect(() => {
    if (!isOpen || !hasItems) {
      setResolvedScrollTarget(null);
      return;
    }

    const scrollEl = resolveScrollContainer();
    if (!scrollEl) return;

    lastScrollTopRef.current = scrollEl.scrollTop;
    applyFollowFromBottomRange();
    scrollToBottom(true);

    return () => {
      cancelScheduledScroll();
      clearUserScrollSettleTimeout();
      clearProgrammaticScrollTimeout();
      if (scrollContainerRef.current === scrollEl) {
        setResolvedScrollTarget(null);
      }
    };
  }, [
    applyFollowFromBottomRange,
    cancelScheduledScroll,
    clearProgrammaticScrollTimeout,
    clearUserScrollSettleTimeout,
    hasItems,
    isOpen,
    resolveScrollContainer,
    scrollToBottom,
    setResolvedScrollTarget,
  ]);

  React.useEffect(() => {
    if (!isOpen || !hasItems || !scrollTarget) return;
    const endEl = endElementRef.current;
    if (!endEl) return;
    const scrollEl = scrollTarget;

    scrollContainerRef.current = scrollEl;

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          restoreFollowIfBottom();
        }
      },
      {
        root: scrollEl,
        rootMargin: `0px 0px ${BOTTOM_THRESHOLD_PX}px 0px`,
        threshold: 0,
      },
    );
    intersectionObserver.observe(endEl);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && endEl.parentElement) {
      resizeObserver = new ResizeObserver(() => {
        scrollToBottom(false);
      });
      resizeObserver.observe(endEl.parentElement);
    }

    return () => {
      intersectionObserver.disconnect();
      resizeObserver?.disconnect();
      cancelScheduledScroll();
      clearUserScrollSettleTimeout();
      clearProgrammaticScrollTimeout();
      if (scrollContainerRef.current === scrollEl) {
        scrollContainerRef.current = null;
      }
    };
  }, [
    cancelScheduledScroll,
    clearProgrammaticScrollTimeout,
    clearUserScrollSettleTimeout,
    hasItems,
    isOpen,
    restoreFollowIfBottom,
    scrollTarget,
    scrollToBottom,
  ]);

  return {
    bodyStyle: timelineBodyStyle,
    endRef,
    scrollToBottom,
  };
};
