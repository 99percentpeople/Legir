// Helper to find page index from mouse coordinates.
//
// Virtualization note:
// - When pages are virtualized, many page DOM nodes may be unmounted.
// - In that case, we can fall back to rect-based hit testing using precomputed
//   page rects inside the workspace content box.
export const getPageIndexFromPoint = (
  x: number,
  y: number,
  activePageIndex: number | null,
  pageCount: number,
  options?: {
    getPageRectByPageIndex?: (pageIndex: number) => {
      top: number;
      left: number;
      width: number;
      height: number;
      right: number;
      bottom: number;
    } | null;
    contentEl?: HTMLElement | null;
    axis?: "vertical" | "horizontal";
  },
) => {
  // DOM fast-path: check current active page first for performance.
  if (activePageIndex !== null) {
    const pageEl = document.getElementById(`page-${activePageIndex}`);
    if (pageEl) {
      const rect = pageEl.getBoundingClientRect();
      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        return activePageIndex;
      }
    }
  }

  const contentEl = options?.contentEl;
  const getRect = options?.getPageRectByPageIndex;
  const axis = options?.axis ?? "vertical";
  if (contentEl && getRect) {
    // Rect-based hit-test: works even when pages are unmounted.
    // Requires rects to be in content-local coordinates.
    const contentBox = contentEl.getBoundingClientRect();
    const cx = x - contentBox.left;
    const cy = y - contentBox.top;

    if (activePageIndex !== null) {
      const r = getRect(activePageIndex);
      if (r) {
        if (
          cx >= r.left &&
          cx <= r.left + r.width &&
          cy >= r.top &&
          cy <= r.top + r.height
        ) {
          return activePageIndex;
        }
      }
    }

    const getEnd = (i: number) => {
      const r = getRect(i);
      if (!r) return 0;
      return axis === "vertical" ? r.bottom : r.right;
    };

    const pos = axis === "vertical" ? cy : cx;
    let lo = 0;
    let hi = pageCount - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (getEnd(mid) >= pos) {
        ans = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    const base = getRect(ans);
    if (!base) return null;

    // In double layouts, multiple pages can share the same row/column start.
    // We find the group with the same `top` (vertical) / `left` (horizontal), then
    // scan only that small group for the exact hit.
    const groupKey = axis === "vertical" ? base.top : base.left;
    let start = ans;
    while (start > 0) {
      const r = getRect(start - 1);
      if (!r) break;
      const k = axis === "vertical" ? r.top : r.left;
      if (k !== groupKey) break;
      start -= 1;
    }

    let end = ans;
    while (end + 1 < pageCount) {
      const r = getRect(end + 1);
      if (!r) break;
      const k = axis === "vertical" ? r.top : r.left;
      if (k !== groupKey) break;
      end += 1;
    }

    for (let i = start; i <= end; i++) {
      const r = getRect(i);
      if (!r) continue;
      if (
        cx >= r.left &&
        cx <= r.left + r.width &&
        cy >= r.top &&
        cy <= r.top + r.height
      ) {
        return i;
      }
    }

    return null;
  }

  // DOM fallback: check other pages (O(N) in page count).
  for (let i = 0; i < pageCount; i++) {
    if (i === activePageIndex) continue;
    const pageEl = document.getElementById(`page-${i}`);
    if (pageEl) {
      const rect = pageEl.getBoundingClientRect();
      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        return i;
      }
    }
  }

  return null;
};
