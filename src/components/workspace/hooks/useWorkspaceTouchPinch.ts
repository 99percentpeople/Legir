import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useEventListeners } from "@/hooks/useEventListener";
import type { Tool } from "@/types";

type TouchPoint = {
  clientX: number;
  clientY: number;
};

type PinchSession = {
  initialDistance: number;
  initialScale: number;
  lastScale: number;
  lastMidpoint: TouchPoint;
};

type SingleTouchSession = {
  startPoint: TouchPoint;
  lastPoint: TouchPoint;
  isActive: boolean;
};

const MIN_PINCH_DISTANCE_PX = 8;
const SINGLE_TOUCH_PAN_THRESHOLD_PX = 6;

const clampWorkspaceScale = (scale: number) => {
  return Math.max(0.25, Math.min(5.0, scale));
};

const touchListToArray = (touches: TouchList) => {
  const result: Touch[] = [];
  for (let i = 0; i < touches.length; i += 1) {
    const touch = touches.item(i);
    if (touch) result.push(touch);
  }
  return result;
};

const touchToPoint = (touch: Touch): TouchPoint => ({
  clientX: touch.clientX,
  clientY: touch.clientY,
});

const getTouchesWithinContainer = (
  touches: TouchList,
  container: HTMLElement,
) => {
  const rect = container.getBoundingClientRect();
  const hitSlop = 24;

  return touchListToArray(touches).filter((touch) => {
    return (
      touch.clientX >= rect.left - hitSlop &&
      touch.clientX <= rect.right + hitSlop &&
      touch.clientY >= rect.top - hitSlop &&
      touch.clientY <= rect.bottom + hitSlop
    );
  });
};

const getTouchDistance = (a: TouchPoint, b: TouchPoint) => {
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
};

const getTouchMidpoint = (a: TouchPoint, b: TouchPoint): TouchPoint => ({
  clientX: (a.clientX + b.clientX) / 2,
  clientY: (a.clientY + b.clientY) / 2,
});

const stopTouchEvent = (event: TouchEvent) => {
  if (event.cancelable) {
    event.preventDefault();
  }
  event.stopPropagation();
};

const canStartViewportGestureFromTarget = (
  target: EventTarget | null,
  container: HTMLElement,
) => {
  if (!(target instanceof HTMLElement)) return false;
  if (!container.contains(target)) return false;

  return !target.closest(
    [
      ".textLayer",
      "[data-ff-selection-handle='1']",
      "input",
      "textarea",
      "select",
      "[contenteditable='true']",
      "[id^='field-element-']",
      "[id^='annotation-']",
      "button",
      "a",
      "[role='button']",
      "[role='link']",
    ].join(", "),
  );
};

export const useWorkspaceTouchPinch = (opts: {
  containerRef: RefObject<HTMLElement>;
  enabled: boolean;
  scale: number;
  tool: Tool;
  onPinchStart?: () => void;
  onPinchStateChange?: (active: boolean) => void;
  onPinchZoom: (args: {
    clientX: number;
    clientY: number;
    newScale: number;
  }) => void;
  onPinchPan: (deltaX: number, deltaY: number) => void;
}) => {
  const activeTouchPointsRef = useRef(new Map<number, TouchPoint>());
  const pinchSessionRef = useRef<PinchSession | null>(null);
  const singleTouchSessionRef = useRef<SingleTouchSession | null>(null);
  const liveScaleRef = useRef(opts.scale);
  const gestureActiveRef = useRef(false);

  useEffect(() => {
    liveScaleRef.current = opts.scale;
  }, [opts.scale]);

  const updateGestureActive = useCallback(
    (active: boolean) => {
      if (gestureActiveRef.current === active) return;
      gestureActiveRef.current = active;
      opts.onPinchStateChange?.(active);
    },
    [opts.onPinchStateChange],
  );

  const beginViewportGesture = useCallback(() => {
    if (gestureActiveRef.current) return;
    opts.onPinchStart?.();
    updateGestureActive(true);
  }, [opts.onPinchStart, updateGestureActive]);

  const clearPinchSession = useCallback(() => {
    pinchSessionRef.current = null;
  }, []);

  const clearSingleTouchSession = useCallback(() => {
    singleTouchSessionRef.current = null;
  }, []);

  const endViewportGesture = useCallback(() => {
    clearPinchSession();
    clearSingleTouchSession();
    updateGestureActive(false);
  }, [clearPinchSession, clearSingleTouchSession, updateGestureActive]);

  const startPinchSession = useCallback(
    (event?: TouchEvent) => {
      if (!opts.enabled || activeTouchPointsRef.current.size < 2) {
        return false;
      }

      const [first, second] = Array.from(activeTouchPointsRef.current.values());
      if (!first || !second) return false;
      const midpoint = getTouchMidpoint(first, second);

      beginViewportGesture();
      clearSingleTouchSession();
      pinchSessionRef.current = {
        initialDistance: Math.max(
          MIN_PINCH_DISTANCE_PX,
          getTouchDistance(first, second),
        ),
        initialScale: liveScaleRef.current,
        lastScale: liveScaleRef.current,
        lastMidpoint: midpoint,
      };

      if (event) stopTouchEvent(event);
      return true;
    },
    [beginViewportGesture, clearSingleTouchSession, opts.enabled],
  );

  const syncTrackedTouches = useCallback(
    (touches: TouchList, container: HTMLElement) => {
      const nextMap = new Map<number, TouchPoint>();
      for (const touch of getTouchesWithinContainer(touches, container)) {
        nextMap.set(touch.identifier, touchToPoint(touch));
      }
      activeTouchPointsRef.current = nextMap;
    },
    [],
  );

  const handleTouchStart = useCallback(
    (event: TouchEvent) => {
      if (!opts.enabled) return;

      const container = opts.containerRef.current;
      if (!container) return;

      for (const touch of touchListToArray(event.changedTouches)) {
        const target = touch.target;
        if (!(target instanceof Node) || !container.contains(target)) {
          continue;
        }

        activeTouchPointsRef.current.set(touch.identifier, touchToPoint(touch));

        if (
          (opts.tool === "select" || opts.tool === "pan") &&
          activeTouchPointsRef.current.size === 1 &&
          canStartViewportGestureFromTarget(target, container)
        ) {
          const point = touchToPoint(touch);
          singleTouchSessionRef.current = {
            startPoint: point,
            lastPoint: point,
            isActive: false,
          };
        }
      }

      syncTrackedTouches(event.touches, container);

      if (activeTouchPointsRef.current.size >= 2) {
        startPinchSession(event);
      }
    },
    [
      opts.containerRef,
      opts.enabled,
      opts.tool,
      startPinchSession,
      syncTrackedTouches,
    ],
  );

  const handleTouchMove = useCallback(
    (event: TouchEvent) => {
      const container = opts.containerRef.current;
      if (!container) return;
      syncTrackedTouches(event.touches, container);

      const pinchSession = pinchSessionRef.current;
      if (pinchSession && activeTouchPointsRef.current.size >= 2) {
        stopTouchEvent(event);

        const [first, second] = Array.from(
          activeTouchPointsRef.current.values(),
        );
        if (!first || !second) return;
        const midpoint = getTouchMidpoint(first, second);
        const distance = Math.max(
          MIN_PINCH_DISTANCE_PX,
          getTouchDistance(first, second),
        );
        const deltaX = midpoint.clientX - pinchSession.lastMidpoint.clientX;
        const deltaY = midpoint.clientY - pinchSession.lastMidpoint.clientY;
        const nextScale = Number(
          clampWorkspaceScale(
            pinchSession.initialScale *
              (distance / pinchSession.initialDistance),
          ).toFixed(3),
        );

        if (Math.abs(deltaX) >= 0.5 || Math.abs(deltaY) >= 0.5) {
          opts.onPinchPan(deltaX, deltaY);
        }

        pinchSession.lastMidpoint = midpoint;

        if (Math.abs(nextScale - pinchSession.lastScale) >= 0.001) {
          pinchSession.lastScale = nextScale;
          liveScaleRef.current = nextScale;
          opts.onPinchZoom({
            clientX: midpoint.clientX,
            clientY: midpoint.clientY,
            newScale: nextScale,
          });
        }
        return;
      }

      const singleTouchSession = singleTouchSessionRef.current;
      if (singleTouchSession && activeTouchPointsRef.current.size === 1) {
        const point = Array.from(activeTouchPointsRef.current.values())[0];

        if (!singleTouchSession.isActive) {
          const totalDx = point.clientX - singleTouchSession.startPoint.clientX;
          const totalDy = point.clientY - singleTouchSession.startPoint.clientY;
          if (Math.hypot(totalDx, totalDy) < SINGLE_TOUCH_PAN_THRESHOLD_PX) {
            return;
          }

          beginViewportGesture();
          singleTouchSession.isActive = true;
        }

        stopTouchEvent(event);
        const deltaX = point.clientX - singleTouchSession.lastPoint.clientX;
        const deltaY = point.clientY - singleTouchSession.lastPoint.clientY;
        singleTouchSession.lastPoint = point;

        if (Math.abs(deltaX) >= 0.5 || Math.abs(deltaY) >= 0.5) {
          opts.onPinchPan(deltaX, deltaY);
        }
        return;
      }

      if (activeTouchPointsRef.current.size >= 2) {
        startPinchSession(event);
      }
    },
    [
      beginViewportGesture,
      opts.containerRef,
      opts.onPinchPan,
      opts.onPinchZoom,
      startPinchSession,
      syncTrackedTouches,
    ],
  );

  const handleTouchEnd = useCallback(
    (event: TouchEvent) => {
      const container = opts.containerRef.current;
      if (!container) return;
      syncTrackedTouches(event.touches, container);

      if (pinchSessionRef.current) {
        stopTouchEvent(event);

        if (activeTouchPointsRef.current.size === 1) {
          const remainingPoint = Array.from(
            activeTouchPointsRef.current.values(),
          )[0];
          clearPinchSession();
          singleTouchSessionRef.current = {
            startPoint: remainingPoint,
            lastPoint: remainingPoint,
            isActive: false,
          };
          return;
        }
      }

      if (activeTouchPointsRef.current.size === 0) {
        endViewportGesture();
        return;
      }

      if (activeTouchPointsRef.current.size === 1 && !pinchSessionRef.current) {
        const singleTouchSession = singleTouchSessionRef.current;
        if (singleTouchSession?.isActive) {
          return;
        }
      }

      if (activeTouchPointsRef.current.size >= 2) {
        startPinchSession(event);
      }
    },
    [
      clearPinchSession,
      endViewportGesture,
      opts.containerRef,
      startPinchSession,
      syncTrackedTouches,
    ],
  );

  useEventListeners(typeof document !== "undefined" ? document : null, [
    {
      type: "touchstart",
      handler: handleTouchStart,
      options: { capture: true, passive: false },
    },
    {
      type: "touchmove",
      handler: handleTouchMove,
      options: { capture: true, passive: false },
    },
    {
      type: "touchend",
      handler: handleTouchEnd,
      options: { capture: true, passive: false },
    },
    {
      type: "touchcancel",
      handler: handleTouchEnd,
      options: { capture: true, passive: false },
    },
  ]);

  useEffect(() => {
    if (opts.enabled) return;
    activeTouchPointsRef.current.clear();
    endViewportGesture();
  }, [endViewportGesture, opts.enabled]);

  useEffect(() => {
    return () => {
      activeTouchPointsRef.current.clear();
      endViewportGesture();
    };
  }, [endViewportGesture]);
};
