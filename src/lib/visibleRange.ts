export type VisibleRange = {
  start: number;
  end: number;
};

export const findVisibleRange = (opts: {
  starts: number[];
  ends: number[];
  viewStart: number;
  viewEnd: number;
  overscan?: number;
  pinIndex?: number | null;
}) => {
  const count = Math.min(opts.starts.length, opts.ends.length);
  if (count === 0) return null;

  const overscan = typeof opts.overscan === "number" ? opts.overscan : 0;
  const starts = opts.starts;
  const ends = opts.ends;

  let start = 0;
  {
    let lo = 0;
    let hi = count - 1;
    let ans = count - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ends[mid] >= opts.viewStart) {
        ans = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    start = ans;
  }

  let end = count - 1;
  {
    let lo = 0;
    let hi = count - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= opts.viewEnd) {
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

  if (typeof opts.pinIndex === "number") {
    const pin = Math.max(0, Math.min(opts.pinIndex, count - 1));
    if (pin < start) start = pin;
    if (pin > end) end = pin;
  }

  if (end < start) {
    start = 0;
    end = Math.min(count - 1, overscan * 2);
  }

  return { start, end } satisfies VisibleRange;
};
