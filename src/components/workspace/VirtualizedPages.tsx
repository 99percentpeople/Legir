import React, {
  useCallback,
  useEffect,
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
  containerRef: React.RefObject<HTMLElement>;
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

  const [range, setRange] = useState<Range>(() => {
    const end = Math.max(0, props.items.length - 1);
    return { start: 0, end };
  });

  const rafRef = useRef<number | null>(null);

  const updateRange = useCallback(() => {
    if (!props.enabled) {
      setRange({ start: 0, end: Math.max(0, props.items.length - 1) });
      return;
    }

    const container = props.containerRef.current;
    if (!container) return;

    const count = props.items.length;
    if (count === 0) return;

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
      pinIndex: props.pinIndex,
    });
    if (!nextRange) return;

    setRange((prev) =>
      prev.start === nextRange.start && prev.end === nextRange.end
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
    props.pinIndex,
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

  useEffect(() => {
    if (!props.enabled) {
      setRange({ start: 0, end: Math.max(0, props.items.length - 1) });
      return;
    }
    scheduleUpdate();
  }, [
    props.enabled,
    props.items.length,
    props.axis,
    props.rects,
    props.layoutEpoch,
    scheduleUpdate,
  ]);

  useEffect(() => {
    const container = props.containerRef.current;
    if (!container) return;
    const onScroll = () => scheduleUpdate();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
    };
  }, [props.containerRef, scheduleUpdate]);

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

  return (
    <>
      {props.items.slice(range.start, range.end + 1).map((item, i) => {
        const index = range.start + i;
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
