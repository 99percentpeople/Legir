import { useCallback, useEffect, useRef, type RefObject } from "react";
import { normalizeViewportScale, type ZoomBounds } from "@/lib/viewportZoom";
import { useEventListeners } from "@/hooks/useEventListener";

export type TouchPoint = {
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
  inertiaEligible: boolean;
};

const MIN_PINCH_DISTANCE_PX = 8;
const SINGLE_TOUCH_PAN_THRESHOLD_PX = 6;
const TOUCH_PAN_INERTIA_MIN_SPEED_PX_PER_MS = 0.08;
const TOUCH_PAN_INERTIA_STOP_SPEED_PX_PER_MS = 0.015;
const TOUCH_PAN_INERTIA_DECAY_PER_FRAME = 0.94;

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

export const canPanViewportFromTarget = (
  target: EventTarget | null,
  container: HTMLElement,
) => {
  if (!(target instanceof HTMLElement)) return false;
  if (!container.contains(target)) return false;

  return !target.closest(
    [
      ".textLayer",
      "[data-app-selection-handle='1']",
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

export const useViewportTouchGestures = (
  opts: ZoomBounds & {
    containerRef: RefObject<HTMLElement | null>;
    enabled: boolean;
    scale: number;
    panEnabled: boolean;
    canStartPinch?: () => boolean;
    onPinchBegin?: (point: TouchPoint) => void;
    getDoubleTapTarget?: (target: EventTarget | null) => Element | null;
    onDoubleTap?: (point: TouchPoint) => void;
    onPinchStart?: () => void;
    onPinchStateChange?: (active: boolean) => void;
    onPinchZoom: (args: {
      clientX: number;
      clientY: number;
      newScale: number;
    }) => void;
    onPinchPan: (deltaX: number, deltaY: number) => void;
  },
) => {
  const activeTouchPointsRef = useRef(new Map<number, TouchPoint>());
  const pinchSessionRef = useRef<PinchSession | null>(null);
  const singleTouchSessionRef = useRef<SingleTouchSession | null>(null);
  const singleTouchVelocityRef = useRef({ x: 0, y: 0 });
  const singleTouchLastSampleRef = useRef<{
    clientX: number;
    clientY: number;
    time: number;
  } | null>(null);
  const inertiaRafRef = useRef<number | null>(null);
  const inertiaLastFrameTimeRef = useRef<number | null>(null);
  const liveScaleRef = useRef(opts.scale);
  const gestureActiveRef = useRef(false);
  const suppressClickUntilRef = useRef(0);
  const tapRef = useRef<{
    point: TouchPoint;
    target: Element;
    time: number;
  } | null>(null);
  const lastTapRef = useRef<{
    point: TouchPoint;
    target: Element;
    time: number;
  } | null>(null);
  const shouldSuppressClick = useCallback(
    () =>
      gestureActiveRef.current ||
      performance.now() < suppressClickUntilRef.current,
    [],
  );

  useEffect(() => {
    liveScaleRef.current = opts.scale;
  }, [opts.scale]);

  const updateGestureActive = useCallback(
    (active: boolean) => {
      if (gestureActiveRef.current === active) return;
      gestureActiveRef.current = active;
      if (!active) suppressClickUntilRef.current = performance.now() + 350;
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
    singleTouchLastSampleRef.current = null;
  }, []);

  const cancelSingleTouchInertia = useCallback(() => {
    if (inertiaRafRef.current !== null) {
      cancelAnimationFrame(inertiaRafRef.current);
      inertiaRafRef.current = null;
    }
    inertiaLastFrameTimeRef.current = null;
    singleTouchVelocityRef.current = { x: 0, y: 0 };
  }, []);

  const endViewportGesture = useCallback(() => {
    clearPinchSession();
    clearSingleTouchSession();
    updateGestureActive(false);
  }, [clearPinchSession, clearSingleTouchSession, updateGestureActive]);

  const startSingleTouchInertia = useCallback(() => {
    const initialVelocity = { ...singleTouchVelocityRef.current };
    if (
      Math.hypot(initialVelocity.x, initialVelocity.y) <
      TOUCH_PAN_INERTIA_MIN_SPEED_PX_PER_MS
    ) {
      singleTouchVelocityRef.current = { x: 0, y: 0 };
      return;
    }

    cancelSingleTouchInertia();
    singleTouchVelocityRef.current = initialVelocity;

    const tick = (now: number) => {
      const lastFrame = inertiaLastFrameTimeRef.current ?? now;
      const dt = Math.max(1, now - lastFrame);
      inertiaLastFrameTimeRef.current = now;

      const deltaX = singleTouchVelocityRef.current.x * dt;
      const deltaY = singleTouchVelocityRef.current.y * dt;
      if (Math.abs(deltaX) >= 0.1 || Math.abs(deltaY) >= 0.1) {
        opts.onPinchPan(deltaX, deltaY);
      }

      const decay = Math.pow(TOUCH_PAN_INERTIA_DECAY_PER_FRAME, dt / 16.667);
      singleTouchVelocityRef.current = {
        x: singleTouchVelocityRef.current.x * decay,
        y: singleTouchVelocityRef.current.y * decay,
      };

      if (
        Math.hypot(
          singleTouchVelocityRef.current.x,
          singleTouchVelocityRef.current.y,
        ) < TOUCH_PAN_INERTIA_STOP_SPEED_PX_PER_MS
      ) {
        cancelSingleTouchInertia();
        return;
      }

      inertiaRafRef.current = requestAnimationFrame(tick);
    };

    inertiaRafRef.current = requestAnimationFrame(tick);
  }, [cancelSingleTouchInertia, opts]);

  const startPinchSession = useCallback(
    (event?: TouchEvent) => {
      if (
        !opts.enabled ||
        opts.canStartPinch?.() === false ||
        activeTouchPointsRef.current.size < 2
      ) {
        return false;
      }

      const [first, second] = Array.from(activeTouchPointsRef.current.values());
      if (!first || !second) return false;
      const midpoint = getTouchMidpoint(first, second);

      tapRef.current = null;
      lastTapRef.current = null;
      beginViewportGesture();
      opts.onPinchBegin?.(midpoint);
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
    [
      beginViewportGesture,
      clearSingleTouchSession,
      opts.enabled,
      opts.canStartPinch,
      opts.onPinchBegin,
    ],
  );

  const syncTrackedTouches = useCallback((touches: TouchList) => {
    const nextMap = new Map<number, TouchPoint>();
    for (const touch of touchListToArray(touches)) {
      // Track only fingers that started here; keep them when they leave the
      // viewport. A finger on a toolbar or another editor is not a pinch.
      if (activeTouchPointsRef.current.has(touch.identifier))
        nextMap.set(touch.identifier, touchToPoint(touch));
    }
    activeTouchPointsRef.current = nextMap;
  }, []);

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

        cancelSingleTouchInertia();
        activeTouchPointsRef.current.set(touch.identifier, touchToPoint(touch));
        const tapTarget = opts.getDoubleTapTarget?.(target);
        tapRef.current =
          activeTouchPointsRef.current.size === 1 && tapTarget
            ? {
                point: touchToPoint(touch),
                target: tapTarget,
                time: performance.now(),
              }
            : null;
        if (!tapRef.current) lastTapRef.current = null;

        if (
          opts.panEnabled &&
          activeTouchPointsRef.current.size === 1 &&
          canPanViewportFromTarget(target, container)
        ) {
          const point = touchToPoint(touch);
          singleTouchSessionRef.current = {
            startPoint: point,
            lastPoint: point,
            isActive: false,
            inertiaEligible: true,
          };
          singleTouchLastSampleRef.current = {
            clientX: point.clientX,
            clientY: point.clientY,
            time: performance.now(),
          };
          singleTouchVelocityRef.current = { x: 0, y: 0 };
        }
      }

      syncTrackedTouches(event.touches);

      if (activeTouchPointsRef.current.size >= 2 && !pinchSessionRef.current) {
        startPinchSession(event);
      }
    },
    [
      cancelSingleTouchInertia,
      opts.containerRef,
      opts.enabled,
      opts.panEnabled,
      opts.getDoubleTapTarget,
      startPinchSession,
      syncTrackedTouches,
    ],
  );

  const handleTouchMove = useCallback(
    (event: TouchEvent) => {
      const container = opts.containerRef.current;
      if (!opts.enabled || !container || !activeTouchPointsRef.current.size)
        return;
      syncTrackedTouches(event.touches);

      const tap = tapRef.current;
      const touch = activeTouchPointsRef.current.values().next().value;
      if (
        tap &&
        touch &&
        getTouchDistance(tap.point, touch) >= SINGLE_TOUCH_PAN_THRESHOLD_PX
      ) {
        tapRef.current = null;
        lastTapRef.current = null;
      }
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
        const nextScale = normalizeViewportScale(
          pinchSession.initialScale * (distance / pinchSession.initialDistance),
          opts,
        );
        const scaleChanged =
          Math.abs(nextScale - pinchSession.lastScale) >= 0.001;
        if (
          scaleChanged ||
          Math.abs(deltaX) >= 0.5 ||
          Math.abs(deltaY) >= 0.5
        ) {
          pinchSession.lastScale = nextScale;
          liveScaleRef.current = nextScale;
          opts.onPinchZoom({ ...midpoint, newScale: nextScale });
        }
        pinchSession.lastMidpoint = midpoint;
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
        const now = performance.now();
        const lastSample = singleTouchLastSampleRef.current;
        if (lastSample) {
          const dt = now - lastSample.time;
          if (dt > 0) {
            const instantVelocityX = deltaX / dt;
            const instantVelocityY = deltaY / dt;
            singleTouchVelocityRef.current = {
              x:
                singleTouchVelocityRef.current.x * 0.2 + instantVelocityX * 0.8,
              y:
                singleTouchVelocityRef.current.y * 0.2 + instantVelocityY * 0.8,
            };
          }
        }
        singleTouchLastSampleRef.current = {
          clientX: point.clientX,
          clientY: point.clientY,
          time: now,
        };
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
      opts.enabled,
      opts.minScale,
      opts.maxScale,
      opts.onPinchPan,
      opts.onPinchZoom,
      startPinchSession,
      syncTrackedTouches,
    ],
  );

  const handleTouchEnd = useCallback(
    (event: TouchEvent) => {
      const container = opts.containerRef.current;
      if (!opts.enabled || !container || !activeTouchPointsRef.current.size)
        return;
      if (
        !touchListToArray(event.changedTouches).some((touch) =>
          activeTouchPointsRef.current.has(touch.identifier),
        )
      )
        return;
      syncTrackedTouches(event.touches);
      if (event.type === "touchcancel") {
        if (gestureActiveRef.current) stopTouchEvent(event);
        activeTouchPointsRef.current.clear();
        tapRef.current = null;
        lastTapRef.current = null;
        cancelSingleTouchInertia();
        endViewportGesture();
        return;
      }
      const tap = tapRef.current;
      if (activeTouchPointsRef.current.size === 0) {
        tapRef.current = null;
        const ended = touchListToArray(event.changedTouches)[0];
        const now = performance.now();
        if (
          event.type === "touchend" &&
          tap &&
          ended &&
          now - tap.time <= 250 &&
          getTouchDistance(tap.point, touchToPoint(ended)) <
            SINGLE_TOUCH_PAN_THRESHOLD_PX &&
          opts.getDoubleTapTarget?.(ended.target) === tap.target
        ) {
          const lastTap = lastTapRef.current;
          if (
            lastTap &&
            lastTap.target === tap.target &&
            now - lastTap.time <= 300 &&
            getTouchDistance(lastTap.point, tap.point) <= 24
          ) {
            lastTapRef.current = null;
            suppressClickUntilRef.current = now + 350;
            stopTouchEvent(event);
            opts.onDoubleTap?.(touchToPoint(ended));
          } else {
            lastTapRef.current = { ...tap, time: now };
          }
        } else lastTapRef.current = null;
      }
      if (gestureActiveRef.current) stopTouchEvent(event);
      const shouldStartSingleTouchInertia =
        event.type === "touchend" &&
        !!singleTouchSessionRef.current?.isActive &&
        !!singleTouchSessionRef.current?.inertiaEligible &&
        !pinchSessionRef.current &&
        activeTouchPointsRef.current.size === 0;

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
            inertiaEligible: false,
          };
          singleTouchLastSampleRef.current = {
            clientX: remainingPoint.clientX,
            clientY: remainingPoint.clientY,
            time: performance.now(),
          };
          singleTouchVelocityRef.current = { x: 0, y: 0 };
          return;
        }
      }

      if (activeTouchPointsRef.current.size === 0) {
        endViewportGesture();
        if (shouldStartSingleTouchInertia) {
          startSingleTouchInertia();
        }
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
      cancelSingleTouchInertia,
      clearPinchSession,
      endViewportGesture,
      opts.containerRef,
      opts.enabled,
      opts.getDoubleTapTarget,
      opts.onDoubleTap,
      startPinchSession,
      startSingleTouchInertia,
      syncTrackedTouches,
    ],
  );

  useEventListeners(typeof document !== "undefined" ? document : null, [
    {
      type: "touchstart",
      handler: (event) => handleTouchStart(event as TouchEvent),
      options: { capture: true, passive: false },
    },
    {
      type: "touchmove",
      handler: (event) => handleTouchMove(event as TouchEvent),
      options: { capture: true, passive: false },
    },
    {
      type: "touchend",
      handler: (event) => handleTouchEnd(event as TouchEvent),
      options: { capture: true, passive: false },
    },
    {
      type: "touchcancel",
      handler: (event) => handleTouchEnd(event as TouchEvent),
      options: { capture: true, passive: false },
    },
  ]);

  useEffect(() => {
    if (opts.enabled) return;
    activeTouchPointsRef.current.clear();
    tapRef.current = null;
    lastTapRef.current = null;
    cancelSingleTouchInertia();
    endViewportGesture();
  }, [cancelSingleTouchInertia, endViewportGesture, opts.enabled]);

  useEffect(() => {
    return () => {
      activeTouchPointsRef.current.clear();
      cancelSingleTouchInertia();
      endViewportGesture();
    };
  }, [cancelSingleTouchInertia, endViewportGesture]);

  return { shouldSuppressClick };
};
