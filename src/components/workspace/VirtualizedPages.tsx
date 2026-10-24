import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { findVisibleRange } from "@/lib/visibleRange";

type Rect = {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};

type Range = { start: number; end: number };

export function VirtualizedPages<T>(props: {
  enabled: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  axis: "vertical" | "horizontal";
  overscan?: number;
  pinIndex?: number | null;
  items: T[];
  // IMPORTANT:
  // - `rects[index]` are absolute positions within the content box (same coordinate
  //   system as `container.scrollTop/scrollLeft`).
  // - Along `axis`, rects MUST be monotonic for the binary search to be correct.
  //   (For double layouts this typically means using grouped/virtual rects.)
  rects: Rect[];
  renderItem: (item: T, index: number) => React.ReactNode;
  getKey: (item: T, index: number) => React.Key;
  layoutEpoch?: number;
}) {
  const overscan = typeof props.overscan === "number" ? props.overscan : 5;

  const axisStarts = useMemo(() => {
    return props.rects.map((r) => (props.axis === "vertical" ? r.top : r.left));
  }, [props.axis, props.rects]);

  const axisEnds = useMemo(() => {
    return props.rects.map((r) =>
      props.axis === "vertical" ? r.bottom : r.right,
    );
  }, [props.axis, props.rects]);

  // Start empty and measure once the ancestor's container ref is attached,
  // instead of mounting the entire document for one frame.
  const [range, setRange] = useState<Range | null>(null);

  const rafRef = useRef<number | null>(null);

  const updateRange = useCallback(() => {
    if (!props.enabled) {
      return;
    }

    const container = props.containerRef.current;
    if (!container) return;

    const count = props.items.length;
    if (count === 0) {
      setRange(null);
      return;
    }

    // Viewport range within the scroll container.
    const viewStart =
      props.axis === "vertical" ? container.scrollTop : container.scrollLeft;
    const viewEnd =
      viewStart +
      (props.axis === "vertical"
        ? container.clientHeight
        : container.clientWidth);

    const nextRange = findVisibleRange({
      starts: axisStarts,
      ends: axisEnds,
      viewStart,
      viewEnd,
      overscan,
    });
    if (!nextRange) return;

    setRange((prev) =>
      prev?.start === nextRange.start && prev.end === nextRange.end
        ? prev
        : nextRange,
    );
  }, [
    axisEnds,
    axisStarts,
    overscan,
    props.axis,
    props.containerRef,
    props.enabled,
    props.items.length,
  ]);

  const scheduleUpdate = useCallback(() => {
    if (!props.enabled) return;
    if (typeof window === "undefined") return;
    if (rafRef.current !== null) return;

    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateRange();
    });
  }, [props.enabled, updateRange]);

  useLayoutEffect(() => {
    // A queued scroll callback may refer to the previous layout/scale.
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    updateRange();
  }, [
    props.enabled,
    props.items.length,
    props.axis,
    props.rects,
    props.layoutEpoch,
    updateRange,
  ]);

  useEffect(() => {
    const container = props.containerRef.current;
    if (!container) return;
    // Ancestor refs can still be null in the child's initial layout effect.
    updateRange();
    const onScroll = () => scheduleUpdate();
    container.addEventListener("scroll", onScroll, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleUpdate);
    observer?.observe(container);
    return () => {
      container.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [props.containerRef, scheduleUpdate, updateRange]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => scheduleUpdate();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [scheduleUpdate]);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  if (!props.enabled) {
    return (
      <>
        {props.items.map((item, index) => (
          <React.Fragment key={props.getKey(item, index)}>
            {props.renderItem(item, index)}
          </React.Fragment>
        ))}
      </>
    );
  }

  const indexes: number[] = [];
  if (range) {
    for (
      let index = range.start;
      index <= Math.min(range.end, props.items.length - 1);
      index++
    ) {
      indexes.push(index);
    }
  }
  // Retain the interaction's page independently. Extending a contiguous range
  // to a distant pin mounts every page crossed by a scrollbar drag/page jump.
  const pin = props.pinIndex;
  if (
    typeof pin === "number" &&
    Number.isInteger(pin) &&
    pin >= 0 &&
    pin < props.items.length &&
    !indexes.includes(pin)
  ) {
    if (indexes.length && pin < indexes[0]) indexes.unshift(pin);
    else indexes.push(pin);
  }

  return (
    <>
      {indexes.map((index) => {
        const item = props.items[index];
        const rect = props.rects[index];
        return (
          <div
            key={props.getKey(item, index)}
            style={{
              position: "absolute",
              top: rect?.top ?? 0,
              left: rect?.left ?? 0,
            }}
          >
            {props.renderItem(item, index)}
          </div>
        );
      })}
    </>
  );
}
