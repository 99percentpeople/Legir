import type { PageFlowDirection, PageLayoutMode } from "@/types";
import {
  WORKSPACE_BASE_PAGE_GAP_PX,
  WORKSPACE_BASE_PADDING_PX,
  WORKSPACE_BOTTOM_PADDING_PX,
} from "@/constants";

type PageLike = {
  pageIndex: number;
  width: number;
  height: number;
};

type Rect = {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};

type LayoutResult = {
  // Actual page rects used for rendering/positioning.
  rects: Rect[];
  // Virtualization rects must be monotonic along the scroll axis.
  // In double layouts, pages in the same row/column share a group rect.
  virtualRects: Rect[];
  contentWidthPx: number;
  contentHeightPx: number;
};

export const computeWorkspacePageRects = <TPage extends PageLike>(opts: {
  pages: TPage[];
  pageRows: Array<Array<TPage>>;
  pageLayout: PageLayoutMode;
  pageFlow: PageFlowDirection;
  scale: number;
  bottomPaddingPx?: number;
}) => {
  const paddingTopPx = WORKSPACE_BASE_PADDING_PX;
  const paddingSidePx = WORKSPACE_BASE_PADDING_PX;
  const paddingBottomPx = opts.bottomPaddingPx ?? WORKSPACE_BOTTOM_PADDING_PX;
  const gapPx = WORKSPACE_BASE_PAGE_GAP_PX * opts.scale;

  const rects: Rect[] = new Array(opts.pages.length);
  const virtualRects: Rect[] = new Array(opts.pages.length);
  const indexByPageIndex = new Map<number, number>();
  for (let i = 0; i < opts.pages.length; i++) {
    const p = opts.pages[i];
    if (p) indexByPageIndex.set(p.pageIndex, i);
  }

  if (opts.pageLayout === "single") {
    if (opts.pageFlow === "vertical") {
      let maxPageWidthPx = 0;
      for (const p of opts.pages) {
        maxPageWidthPx = Math.max(maxPageWidthPx, p.width * opts.scale);
      }

      let y = paddingTopPx;
      for (let i = 0; i < opts.pages.length; i++) {
        const p = opts.pages[i];
        const w = p.width * opts.scale;
        const h = p.height * opts.scale;
        const left = paddingSidePx + (maxPageWidthPx - w) / 2;
        const r = {
          top: y,
          left,
          width: w,
          height: h,
          right: left + w,
          bottom: y + h,
        };
        rects[i] = r;
        virtualRects[i] = r;
        y += h + gapPx;
      }

      const contentWidthPx = maxPageWidthPx + paddingSidePx * 2;
      const lastBottom = rects[rects.length - 1]?.bottom ?? paddingTopPx;
      const contentHeightPx = lastBottom + paddingBottomPx;
      return {
        rects,
        virtualRects,
        contentWidthPx,
        contentHeightPx,
      } satisfies LayoutResult;
    }

    let maxPageHeightPx = 0;
    for (const p of opts.pages) {
      maxPageHeightPx = Math.max(maxPageHeightPx, p.height * opts.scale);
    }

    let x = paddingSidePx;
    for (let i = 0; i < opts.pages.length; i++) {
      const p = opts.pages[i];
      const w = p.width * opts.scale;
      const h = p.height * opts.scale;
      const top = paddingTopPx + (maxPageHeightPx - h) / 2;
      const r = {
        top,
        left: x,
        width: w,
        height: h,
        right: x + w,
        bottom: top + h,
      };
      rects[i] = r;
      virtualRects[i] = r;
      x += w + gapPx;
    }

    const contentWidthPx =
      (rects[rects.length - 1]?.right ?? paddingSidePx) + paddingSidePx;
    const contentHeightPx = paddingTopPx + maxPageHeightPx + paddingBottomPx;
    return {
      rects,
      virtualRects,
      contentWidthPx,
      contentHeightPx,
    } satisfies LayoutResult;
  }

  if (opts.pageFlow === "vertical") {
    let col0WidthPx = 0;
    let col1WidthPx = 0;
    let maxSpanWidthPx = 0;

    for (const row of opts.pageRows) {
      if (row.length === 1) {
        const p = row[0];
        if (!p) continue;
        maxSpanWidthPx = Math.max(maxSpanWidthPx, p.width * opts.scale);
      } else {
        const left = row[0];
        const right = row[1];
        if (left) col0WidthPx = Math.max(col0WidthPx, left.width * opts.scale);
        if (right)
          col1WidthPx = Math.max(col1WidthPx, right.width * opts.scale);
      }
    }

    const baseTotalWidthPx = col0WidthPx + gapPx + col1WidthPx;
    if (maxSpanWidthPx > baseTotalWidthPx) {
      const extra = maxSpanWidthPx - baseTotalWidthPx;
      col0WidthPx += extra / 2;
      col1WidthPx += extra / 2;
    }

    const totalWidthPx = col0WidthPx + gapPx + col1WidthPx;

    let y = paddingTopPx;
    let maxBottom = paddingTopPx;

    for (const row of opts.pageRows) {
      if (row.length === 0) continue;

      const rowHeightPx = Math.max(
        0,
        ...(row.map((p) => (p ? p.height * opts.scale : 0)) as number[]),
      );

      if (row.length === 1) {
        const p = row[0];
        if (!p) continue;
        const idx = indexByPageIndex.get(p.pageIndex);
        if (typeof idx !== "number") continue;

        const w = p.width * opts.scale;
        const h = p.height * opts.scale;
        const left = paddingSidePx + (totalWidthPx - w) / 2;
        const r = {
          top: y,
          left,
          width: w,
          height: h,
          right: left + w,
          bottom: y + h,
        };
        rects[idx] = r;
        virtualRects[idx] = r;
        maxBottom = Math.max(maxBottom, y + h);
        y += rowHeightPx + gapPx;
        continue;
      }

      const leftPage = row[0];
      const rightPage = row[1];

      if (leftPage) {
        const idx = indexByPageIndex.get(leftPage.pageIndex);
        if (typeof idx === "number") {
          const w = leftPage.width * opts.scale;
          const h = leftPage.height * opts.scale;
          const left = paddingSidePx + (col0WidthPx - w);
          const r = {
            top: y,
            left,
            width: w,
            height: h,
            right: left + w,
            bottom: y + h,
          };
          rects[idx] = r;
          virtualRects[idx] = {
            ...r,
            bottom: y + rowHeightPx,
          };
          maxBottom = Math.max(maxBottom, y + h);
        }
      }

      if (rightPage) {
        const idx = indexByPageIndex.get(rightPage.pageIndex);
        if (typeof idx === "number") {
          const w = rightPage.width * opts.scale;
          const h = rightPage.height * opts.scale;
          const left = paddingSidePx + col0WidthPx + gapPx;
          const r = {
            top: y,
            left,
            width: w,
            height: h,
            right: left + w,
            bottom: y + h,
          };
          rects[idx] = r;
          virtualRects[idx] = {
            ...r,
            bottom: y + rowHeightPx,
          };
          maxBottom = Math.max(maxBottom, y + h);
        }
      }

      y += rowHeightPx + gapPx;
    }

    const contentWidthPx = totalWidthPx + paddingSidePx * 2;
    const contentHeightPx = maxBottom + paddingBottomPx;
    return {
      rects,
      virtualRects,
      contentWidthPx,
      contentHeightPx,
    } satisfies LayoutResult;
  }

  let row0HeightPx = 0;
  let row1HeightPx = 0;
  let maxSpanHeightPx = 0;

  for (const col of opts.pageRows) {
    if (col.length === 1) {
      const p = col[0];
      if (!p) continue;
      maxSpanHeightPx = Math.max(maxSpanHeightPx, p.height * opts.scale);
    } else {
      const p0 = col[0];
      const p1 = col[1];
      if (p0) row0HeightPx = Math.max(row0HeightPx, p0.height * opts.scale);
      if (p1) row1HeightPx = Math.max(row1HeightPx, p1.height * opts.scale);
    }
  }

  const baseTotalHeightPx = row0HeightPx + gapPx + row1HeightPx;
  if (maxSpanHeightPx > baseTotalHeightPx) {
    const extra = maxSpanHeightPx - baseTotalHeightPx;
    row0HeightPx += extra / 2;
    row1HeightPx += extra / 2;
  }

  const totalHeightPx = row0HeightPx + gapPx + row1HeightPx;

  let x = paddingSidePx;
  let maxRight = paddingSidePx;

  for (const col of opts.pageRows) {
    if (col.length === 0) continue;

    if (col.length === 1) {
      const p = col[0];
      if (!p) continue;
      const idx = indexByPageIndex.get(p.pageIndex);
      if (typeof idx !== "number") continue;

      const w = p.width * opts.scale;
      const h = p.height * opts.scale;
      const top = paddingTopPx + (totalHeightPx - h) / 2;
      const r = {
        top,
        left: x,
        width: w,
        height: h,
        right: x + w,
        bottom: top + h,
      };
      rects[idx] = r;
      virtualRects[idx] = r;
      maxRight = Math.max(maxRight, x + w);
      x += w + gapPx;
      continue;
    }

    const p0 = col[0];
    const p1 = col[1];
    const w0 = (p0?.width ?? 0) * opts.scale;
    const w1 = (p1?.width ?? 0) * opts.scale;
    const colWidthPx = Math.max(w0, w1);

    if (p0) {
      const idx = indexByPageIndex.get(p0.pageIndex);
      if (typeof idx === "number") {
        const h0 = p0.height * opts.scale;
        const top = paddingTopPx + (row0HeightPx - h0);
        const r = {
          top,
          left: x,
          width: w0,
          height: h0,
          right: x + w0,
          bottom: top + h0,
        };
        rects[idx] = r;
        virtualRects[idx] = {
          ...r,
          right: x + colWidthPx,
        };
        maxRight = Math.max(maxRight, x + w0);
      }
    }

    if (p1) {
      const idx = indexByPageIndex.get(p1.pageIndex);
      if (typeof idx === "number") {
        const h1 = p1.height * opts.scale;
        const top = paddingTopPx + row0HeightPx + gapPx;
        const r = {
          top,
          left: x,
          width: w1,
          height: h1,
          right: x + w1,
          bottom: top + h1,
        };
        rects[idx] = r;
        virtualRects[idx] = {
          ...r,
          right: x + colWidthPx,
        };
        maxRight = Math.max(maxRight, x + w1);
      }
    }

    x += colWidthPx + gapPx;
  }

  const contentWidthPx = maxRight + paddingSidePx;
  const contentHeightPx = paddingTopPx + totalHeightPx + paddingBottomPx;
  return {
    rects,
    virtualRects,
    contentWidthPx,
    contentHeightPx,
  } satisfies LayoutResult;
};
