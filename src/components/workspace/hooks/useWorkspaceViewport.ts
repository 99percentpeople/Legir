import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  WORKSPACE_BASE_PAGE_GAP_PX,
  WORKSPACE_BASE_PADDING_PX,
  ZOOM_BASE,
} from "@/constants";
import type { EditorState } from "@/types";
import { useEventListener } from "@/hooks/useEventListener";

export const useWorkspaceViewport = (opts: {
  containerRef: RefObject<HTMLDivElement>;
  contentRef: RefObject<HTMLDivElement>;
  editorState: EditorState;
  onScaleChange: (newScale: number) => void;
  isPanning: boolean;
  fitTrigger?: number;
  onPageIndexChange?: (index: number) => void;
  textSelectionToolbarVisible: boolean;
  updateTextSelectionToolbar: () => void;
}) => {
  const zoomAnchorRef = useRef<
    | {
        kind: "content";
        targetX: number;
        targetY: number;
        mouseX: number;
        mouseY: number;
      }
    | {
        kind: "page";
        pageIndex: number;
        pageX: number;
        pageY: number;
        mouseX: number;
        mouseY: number;
      }
    | null
  >(null);

  const viewportAnchorRef = useRef<{
    scale: number;
    pageIndex: number;
    pageX: number;
    pageY: number;
  } | null>(null);

  const scrollRafRef = useRef<number | null>(null);
  const prevScaleRef = useRef(opts.editorState.scale);
  const scrollPosRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  // --- Zoom Effect (Same as before) ---
  useLayoutEffect(() => {
    const container = opts.containerRef.current;
    const content = opts.contentRef.current;
    if (!container || !content) return;

    const applyPageAnchor = (
      anchor: {
        pageIndex: number;
        pageX: number;
        pageY: number;
      },
      mouseX: number,
      mouseY: number,
    ) => {
      const pageEl = document.getElementById(`page-${anchor.pageIndex}`);
      if (!pageEl) return false;

      const containerRect = container.getBoundingClientRect();
      const pageRect = pageEl.getBoundingClientRect();

      const contentX =
        container.scrollLeft +
        (pageRect.left - containerRect.left) +
        anchor.pageX * opts.editorState.scale;
      const contentY =
        container.scrollTop +
        (pageRect.top - containerRect.top) +
        anchor.pageY * opts.editorState.scale;

      container.scrollLeft = contentX - mouseX;
      container.scrollTop = contentY - mouseY;
      return true;
    };

    if (zoomAnchorRef.current) {
      const anchor = zoomAnchorRef.current;
      if (anchor.kind === "page") {
        applyPageAnchor(
          {
            pageIndex: anchor.pageIndex,
            pageX: anchor.pageX,
            pageY: anchor.pageY,
          },
          anchor.mouseX,
          anchor.mouseY,
        );
      } else {
        container.scrollLeft = anchor.targetX - anchor.mouseX;
        container.scrollTop = anchor.targetY - anchor.mouseY;
      }
      zoomAnchorRef.current = null;
    } else if (prevScaleRef.current !== opts.editorState.scale) {
      const rect = container.getBoundingClientRect();
      const viewportW = rect.width;
      const viewportH = rect.height;

      const pre = viewportAnchorRef.current;
      const usedPre =
        opts.editorState.pageLayout !== "single" &&
        pre &&
        Math.abs(pre.scale - prevScaleRef.current) < 0.0001 &&
        applyPageAnchor(
          { pageIndex: pre.pageIndex, pageX: pre.pageX, pageY: pre.pageY },
          viewportW / 2,
          viewportH / 2,
        );

      if (usedPre) {
        // Intentionally skip the simple scaling math below.
      } else {
        const oldScale = prevScaleRef.current;
        const newScale = opts.editorState.scale;
        const scaleRatio = newScale / oldScale;
        const oldScrollLeft = scrollPosRef.current.x;
        const oldScrollTop = scrollPosRef.current.y;
        const centerX_old = oldScrollLeft + viewportW / 2;
        const centerY_old = oldScrollTop + viewportH / 2;
        const centerX_new = centerX_old * scaleRatio;
        const centerY_new = centerY_old * scaleRatio;
        container.scrollLeft = centerX_new - viewportW / 2;
        container.scrollTop = centerY_new - viewportH / 2;
      }
    }
    prevScaleRef.current = opts.editorState.scale;
    scrollPosRef.current = { x: container.scrollLeft, y: container.scrollTop };
  }, [opts.editorState.scale]);

  // --- Wheel Zoom ---
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      const container = opts.containerRef.current;
      if (!container) return;

      if (opts.isPanning) {
        e.preventDefault();
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const content = opts.contentRef.current;
        if (!content) return;

        const distToRectSquared = (x: number, y: number, r: DOMRect) => {
          const inside =
            x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
          const dx = inside
            ? 0
            : x < r.left
              ? r.left - x
              : x > r.right
                ? x - r.right
                : 0;
          const dy = inside
            ? 0
            : y < r.top
              ? r.top - y
              : y > r.bottom
                ? y - r.bottom
                : 0;
          return dx * dx + dy * dy;
        };

        const pickClosestHit = <T extends { pageIndex: number; rect: DOMRect }>(
          x: number,
          y: number,
          candidates: T[],
        ) => {
          let best: T | null = null;
          let bestDist = Infinity;
          for (const c of candidates) {
            const dist = distToRectSquared(x, y, c.rect);
            if (dist < bestDist) {
              bestDist = dist;
              best = c;
              if (dist === 0) break;
            }
          }
          return best;
        };

        const findPageAtPoint = (clientX: number, clientY: number) => {
          const els =
            typeof document.elementsFromPoint === "function"
              ? document.elementsFromPoint(clientX, clientY)
              : [];
          for (const el of els) {
            const pageEl = (el as HTMLElement | null)?.closest?.(
              '[id^="page-"]',
            );
            if (
              pageEl instanceof HTMLElement &&
              pageEl.id.startsWith("page-")
            ) {
              const pageIndex = Number(pageEl.id.slice("page-".length));
              if (!Number.isNaN(pageIndex)) {
                return {
                  pageIndex,
                  rect: pageEl.getBoundingClientRect(),
                  dist: 0,
                };
              }
            }
          }

          let best: { pageIndex: number; rect: DOMRect; dist: number } | null =
            null;

          for (let i = 0; i < opts.editorState.pages.length; i++) {
            const pageIndex = opts.editorState.pages[i]?.pageIndex;
            if (typeof pageIndex !== "number") continue;
            const el = document.getElementById(`page-${pageIndex}`);
            if (!el) continue;
            const r = el.getBoundingClientRect();

            const dist = distToRectSquared(clientX, clientY, r);

            if (!best || dist < best.dist) {
              best = { pageIndex, rect: r, dist };
              if (dist === 0) break;
            }
          }

          return best;
        };

        const findPageNearPointByDom = (
          clientX: number,
          clientY: number,
          probeDx: number,
          probeDy: number,
        ) => {
          const getHit = (x: number, y: number) => {
            const els =
              typeof document.elementsFromPoint === "function"
                ? document.elementsFromPoint(x, y)
                : [];
            for (const el of els) {
              const pageEl = (el as HTMLElement | null)?.closest?.(
                '[id^="page-"]',
              );
              if (
                pageEl instanceof HTMLElement &&
                pageEl.id.startsWith("page-")
              ) {
                const pageIndex = Number(pageEl.id.slice("page-".length));
                if (!Number.isNaN(pageIndex)) {
                  return {
                    pageIndex,
                    rect: pageEl.getBoundingClientRect(),
                  };
                }
              }
            }
            return null;
          };

          const candidates = [
            getHit(clientX, clientY),
            probeDx > 0 ? getHit(clientX - probeDx, clientY) : null,
            probeDx > 0 ? getHit(clientX + probeDx, clientY) : null,
            probeDy > 0 ? getHit(clientX, clientY - probeDy) : null,
            probeDy > 0 ? getHit(clientX, clientY + probeDy) : null,
          ].filter(Boolean) as Array<{ pageIndex: number; rect: DOMRect }>;

          if (candidates.length === 0) return null;
          // Pick the closest page rect to the pointer (works even when pointer is in the gap).
          return pickClosestHit(clientX, clientY, candidates);
        };

        const currentScale = opts.editorState.scale;
        const steps = -e.deltaY / 100;
        let newScale = currentScale * Math.pow(ZOOM_BASE, steps);
        newScale = Math.max(0.25, Math.min(5.0, newScale));
        newScale = Number(newScale.toFixed(3));

        if (Math.abs(newScale - currentScale) < 0.001) return;

        const containerRect = container.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();

        // Relative mouse position to the content box
        const relX = e.clientX - contentRect.left;
        const relY = e.clientY - contentRect.top;

        let targetX = 0;
        let targetY = 0;

        if (opts.editorState.pageLayout !== "single") {
          const rect = container.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;

          const hit = findPageAtPoint(e.clientX, e.clientY);
          if (hit) {
            const { pageIndex, rect: pageRect } = hit;
            const pageX = (e.clientX - pageRect.left) / currentScale;
            const pageY = (e.clientY - pageRect.top) / currentScale;
            const pageW = pageRect.width / currentScale;
            const pageH = pageRect.height / currentScale;

            zoomAnchorRef.current = {
              kind: "page",
              pageIndex,
              pageX: Math.max(0, Math.min(pageW, pageX)),
              pageY: Math.max(0, Math.min(pageH, pageY)),
              mouseX,
              mouseY,
            };
            opts.onScaleChange(newScale);
            return;
          }

          const scaleRatio = newScale / currentScale;
          targetX = relX * scaleRatio;
          targetY = relY * scaleRatio;
        } else {
          const rect = container.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;

          // Prefer page anchoring in single-page mode as well.
          // When the cursor is in the inter-page gap, we probe ±gap/2 to snap to the nearest page.
          const gapPx = WORKSPACE_BASE_PAGE_GAP_PX * currentScale;

          const probe = Math.max(8, Math.min(256, gapPx / 2));
          const domHit =
            opts.editorState.pageFlow === "horizontal"
              ? findPageNearPointByDom(e.clientX, e.clientY, probe, 0)
              : findPageNearPointByDom(e.clientX, e.clientY, 0, probe);
          if (domHit) {
            const { pageIndex, rect: pageRect } = domHit;
            const pageX = (e.clientX - pageRect.left) / currentScale;
            const pageY = (e.clientY - pageRect.top) / currentScale;
            const pageW = pageRect.width / currentScale;
            const pageH = pageRect.height / currentScale;

            zoomAnchorRef.current = {
              kind: "page",
              pageIndex,
              pageX: Math.max(0, Math.min(pageW, pageX)),
              pageY: Math.max(0, Math.min(pageH, pageY)),
              mouseX,
              mouseY,
            };
            opts.onScaleChange(newScale);
            return;
          }

          if (opts.editorState.pageFlow === "horizontal") {
            const scaleRatio = newScale / currentScale;
            targetX = relX * scaleRatio;
            targetY = relY * scaleRatio;
          } else {
            // Decompose Y coordinate into Fixed (padding/gap) and Scaled (pages) parts
            const paddingPx = WORKSPACE_BASE_PADDING_PX;
            const gapPx2 = gapPx;
            let accumulatedH = paddingPx;
            let fixedY = paddingPx;
            let scaledY = 0;

            if (relY < paddingPx) {
              // Mouse in top padding
              fixedY = relY;
              scaledY = 0;
            } else {
              let found = false;
              for (let i = 0; i < opts.editorState.pages.length; i++) {
                const page = opts.editorState.pages[i];
                const pageH = page.height * currentScale;

                // Check if mouse is on this page
                if (relY < accumulatedH + pageH) {
                  scaledY += relY - accumulatedH;
                  found = true;
                  break;
                }
                accumulatedH += pageH;
                scaledY += pageH;

                // Check if mouse is in gap (only if not last page)
                if (i < opts.editorState.pages.length - 1) {
                  if (relY < accumulatedH + gapPx2) {
                    scaledY += relY - accumulatedH;
                    found = true;
                    break;
                  }
                  accumulatedH += gapPx2;
                  scaledY += gapPx2;
                }
              }
              if (!found) {
                // Mouse is below last page (bottom padding)
                fixedY += relY - accumulatedH;
              }
            }

            // Decompose X coordinate (Simple assumption of fixed side padding)
            const fixedXPadding = WORKSPACE_BASE_PADDING_PX;
            let fixedX = fixedXPadding;
            let scaledX = 0;
            if (relX < fixedXPadding) {
              fixedX = relX;
              scaledX = 0;
            } else {
              fixedX = fixedXPadding;
              scaledX = relX - fixedXPadding;
            }

            // Calculate predicted position at new scale
            targetX = scaledX * (newScale / currentScale) + fixedX;
            targetY = scaledY * (newScale / currentScale) + fixedY;
          }
        }

        const mouseX = e.clientX - containerRect.left;
        const mouseY = e.clientY - containerRect.top;

        zoomAnchorRef.current = {
          kind: "content",
          targetX,
          targetY,
          mouseX,
          mouseY,
        };
        opts.onScaleChange(newScale);
      }
    },
    [
      opts.containerRef,
      opts.editorState.pageLayout,
      opts.editorState.pageFlow,
      opts.editorState.pages,
      opts.editorState.scale,
      opts.isPanning,
      opts.onScaleChange,
    ],
  );

  useEventListener<WheelEvent>(
    opts.containerRef.current,
    "wheel",
    handleWheel,
    {
      passive: false,
    },
  );

  const handleViewportScroll = useCallback(() => {
    const container = opts.containerRef.current;
    if (!container) return;

    scrollPosRef.current = {
      x: container.scrollLeft,
      y: container.scrollTop,
    };

    if (typeof window !== "undefined" && scrollRafRef.current === null) {
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null;
        const c = opts.containerRef.current;
        if (!c) return;

        if (opts.textSelectionToolbarVisible) {
          opts.updateTextSelectionToolbar();
        }

        const isDoubleLayout = opts.editorState.pageLayout !== "single";
        const shouldNotifyPageIndex =
          typeof opts.onPageIndexChange === "function";

        // In double-page layout we must maintain `viewportAnchorRef` on scroll.
        // This anchor is used to keep button/fit zoom stable around the viewport center.
        // Page index notification is optional.
        if (isDoubleLayout) {
          const rect = c.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;

          const hitPageElAt = (x: number, y: number) => {
            if (typeof document.elementFromPoint !== "function") return null;
            const hitEl = document.elementFromPoint(x, y) as HTMLElement | null;
            const pageEl = hitEl?.closest?.('[id^="page-"]');
            return pageEl instanceof HTMLElement &&
              pageEl.id.startsWith("page-")
              ? pageEl
              : null;
          };

          // When fit-width centers the spread, the viewport center can land on the gap.
          // Probe nearby points to snap to the nearest page without scanning all pages.
          const gapPx = WORKSPACE_BASE_PAGE_GAP_PX * opts.editorState.scale;
          const probe = Math.max(8, Math.min(256, gapPx / 2 + 4));
          const pageEl =
            hitPageElAt(centerX, centerY) ||
            hitPageElAt(centerX - probe, centerY) ||
            hitPageElAt(centerX + probe, centerY) ||
            hitPageElAt(centerX, centerY - probe) ||
            hitPageElAt(centerX, centerY + probe);

          if (!pageEl) return;

          const idx = Number(pageEl.id.slice("page-".length));
          if (Number.isNaN(idx)) return;

          const r = pageEl.getBoundingClientRect();
          const pageW = r.width / opts.editorState.scale;
          const pageH = r.height / opts.editorState.scale;
          viewportAnchorRef.current = {
            scale: opts.editorState.scale,
            pageIndex: idx,
            pageX: Math.max(
              0,
              Math.min(pageW, (centerX - r.left) / opts.editorState.scale),
            ),
            pageY: Math.max(
              0,
              Math.min(pageH, (centerY - r.top) / opts.editorState.scale),
            ),
          };
          if (shouldNotifyPageIndex) opts.onPageIndexChange?.(idx);
          return;
        } else {
          // In single-page layout, the scroll logic here only exists to notify the current
          // page index; skip all computations if the consumer didn't subscribe.
          if (!shouldNotifyPageIndex) return;
          const scale = opts.editorState.scale;
          const paddingPx = WORKSPACE_BASE_PADDING_PX;
          const gap = WORKSPACE_BASE_PAGE_GAP_PX * scale;

          if (opts.editorState.pageFlow === "horizontal") {
            const scrollLeft = c.scrollLeft;
            const viewportWidth = c.clientWidth;
            const middleX = scrollLeft + viewportWidth / 2;

            let currentX = paddingPx;
            let found = false;

            for (let i = 0; i < opts.editorState.pages.length; i++) {
              const page = opts.editorState.pages[i];
              const pageWidth = page.width * scale;

              if (middleX >= currentX && middleX <= currentX + pageWidth) {
                opts.onPageIndexChange?.(i);
                found = true;
                break;
              }

              if (
                middleX > currentX + pageWidth &&
                middleX < currentX + pageWidth + gap
              ) {
                if (middleX < currentX + pageWidth + gap / 2) {
                  opts.onPageIndexChange?.(i);
                  found = true;
                  break;
                }
              }

              currentX += pageWidth + gap;
            }

            if (
              !found &&
              opts.editorState.pages.length > 0 &&
              middleX >= currentX
            ) {
              opts.onPageIndexChange?.(opts.editorState.pages.length - 1);
            }
          } else {
            const scrollTop = c.scrollTop;
            const viewportHeight = c.clientHeight;
            const middleY = scrollTop + viewportHeight / 2;

            let currentY = paddingPx;
            let found = false;

            for (let i = 0; i < opts.editorState.pages.length; i++) {
              const page = opts.editorState.pages[i];
              const pageHeight = page.height * scale;

              if (middleY >= currentY && middleY <= currentY + pageHeight) {
                opts.onPageIndexChange?.(i);
                found = true;
                break;
              }

              if (
                middleY > currentY + pageHeight &&
                middleY < currentY + pageHeight + gap
              ) {
                if (middleY < currentY + pageHeight + gap / 2) {
                  opts.onPageIndexChange?.(i);
                  found = true;
                  break;
                }
              }

              currentY += pageHeight + gap;
            }

            if (
              !found &&
              opts.editorState.pages.length > 0 &&
              middleY >= currentY
            ) {
              opts.onPageIndexChange?.(opts.editorState.pages.length - 1);
            }
          }
        }
      });
    }
  }, [
    opts.containerRef,
    opts.editorState.pageLayout,
    opts.editorState.pageFlow,
    opts.editorState.pages,
    opts.editorState.scale,
    opts.onPageIndexChange,
    opts.textSelectionToolbarVisible,
    opts.updateTextSelectionToolbar,
  ]);

  // --- Scroll to Center on Document Load, Page Count Change, or Fit Trigger ---
  useEffect(() => {
    if (
      opts.containerRef.current &&
      opts.contentRef.current &&
      opts.editorState.pages.length > 0 &&
      !opts.editorState.pendingViewStateRestore
    ) {
      const container = opts.containerRef.current;
      const content = opts.contentRef.current;

      if (opts.editorState.pageFlow === "horizontal") return;

      // Wait for layout to settle (especially for different page widths)
      // We use requestAnimationFrame to ensure we calculate after render
      // Adding a small timeout to ensure all child components have updated their dimensions
      requestAnimationFrame(() => {
        const scrollLeft = (content.scrollWidth - container.clientWidth) / 2;
        if (scrollLeft > 0) {
          container.scrollLeft = scrollLeft;
        }
      });
    }
  }, [
    opts.editorState.pdfDocument,
    opts.editorState.pages.length,
    opts.editorState.pendingViewStateRestore,
    opts.editorState.pageFlow,
    opts.fitTrigger,
  ]);

  return { handleViewportScroll };
};
