import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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

    const ends = axisEnds;
    const starts = axisStarts;

    // Find first item whose end crosses viewStart.
    let start = 0;
    {
      let lo = 0;
      let hi = count - 1;
      let ans = count - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (ends[mid] >= viewStart) {
          ans = mid;
          hi = mid - 1;
        } else {
          lo = mid + 1;
        }
      }
      start = ans;
    }

    // Find last item whose start is before viewEnd.
    let end = count - 1;
    {
      let lo = 0;
      let hi = count - 1;
      let ans = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= viewEnd) {
          ans = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      end = ans;
    }

    start = Math.max(0, start - overscan);
    end = Math.min(count - 1, end + overscan);

    // Ensure the active/"pinned" item is always mounted (useful for ongoing
    // interactions even when the viewport range jumps).
    if (typeof props.pinIndex === "number") {
      const pin = Math.max(0, Math.min(props.pinIndex, count - 1));
      if (pin < start) start = pin;
      if (pin > end) end = pin;
    }

    if (end < start) {
      start = 0;
      end = Math.min(count - 1, overscan * 2);
    }

    setRange((prev) =>
      prev.start === start && prev.end === end ? prev : { start, end },
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
