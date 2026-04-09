import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";
import {
  WORKSPACE_BASE_PAGE_GAP_PX,
  WORKSPACE_BASE_PADDING_PX,
  ZOOM_BASE,
} from "@/constants";
import type { WorkspaceEditorState } from "@/types";
import { useEventListener } from "@/hooks/useEventListener";
import { pickClosestRectCandidate } from "@/lib/viewportMath";
import { appEventBus } from "@/lib/eventBus";

type WorkspaceContentZoomAnchor = {
  kind: "content";
  targetX: number;
  targetY: number;
  mouseX: number;
  mouseY: number;
};

type WorkspacePageZoomAnchor = {
  kind: "page";
  pageIndex: number;
  pageX: number;
  pageY: number;
  mouseX: number;
  mouseY: number;
};

export type WorkspaceZoomAnchor =
  | WorkspaceContentZoomAnchor
  | WorkspacePageZoomAnchor;

type WorkspaceZoomSource = "wheel" | "pinch";

type PendingZoomCommit = {
  scale: number;
  anchor: WorkspaceZoomAnchor;
};

const clampWorkspaceScale = (scale: number) => {
  return Math.max(0.25, Math.min(5.0, scale));
};

export const useWorkspaceViewport = (opts: {
  containerRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  editorState: WorkspaceEditorState;
  getPageRectByPageIndex?: (pageIndex: number) => {
    top: number;
    left: number;
    width: number;
    height: number;
    right?: number;
    bottom?: number;
  } | null;
  onScaleChange: (newScale: number) => void;
  isPanning: boolean;
  fitTrigger?: number;
  onPageIndexChange?: (index: number) => void;
  textSelectionToolbarVisible: boolean;
  updateTextSelectionToolbar: () => void;
}) => {
  const zoomAnchorRef = useRef<WorkspaceZoomAnchor | null>(null);

  const viewportAnchorRef = useRef<{
    scale: number;
    pageIndex: number;
    pageX: number;
    pageY: number;
  } | null>(null);

  const scrollRafRef = useRef<number | null>(null);
  const zoomCommitRafRef = useRef<number | null>(null);
  const pendingZoomCommitRef = useRef<PendingZoomCommit | null>(null);
  const prevScaleRef = useRef(opts.editorState.scale);
  const scrollPosRef = useRef({ x: 0, y: 0 });
  const skipNextAutoCenterRef = useRef(false);
  const lastNotifiedPageIndexRef = useRef<number | null>(null);
  const pageIndexLockRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      if (zoomCommitRafRef.current !== null) {
        window.cancelAnimationFrame(zoomCommitRafRef.current);
        zoomCommitRafRef.current = null;
      }
    };
  }, []);

  const applyPageAnchor = useCallback(
    (
      anchor: {
        pageIndex: number;
        pageX: number;
        pageY: number;
      },
      mouseX: number,
      mouseY: number,
      scale: number,
    ) => {
      const container = opts.containerRef.current;
      if (!container) return false;

      const pageEl = document.getElementById(`page-${anchor.pageIndex}`);
      if (!pageEl) return false;

      const containerRect = container.getBoundingClientRect();
      const pageRect = pageEl.getBoundingClientRect();

      const contentX =
        container.scrollLeft +
        (pageRect.left - containerRect.left) +
        anchor.pageX * scale;
      const contentY =
        container.scrollTop +
        (pageRect.top - containerRect.top) +
        anchor.pageY * scale;

      container.scrollLeft = contentX - mouseX;
      container.scrollTop = contentY - mouseY;
      return true;
    },
    [opts.containerRef],
  );

  const applyZoomAnchor = useCallback(
    (anchor: WorkspaceZoomAnchor, scale: number) => {
      const container = opts.containerRef.current;
      if (!container) return false;

      if (anchor.kind === "page") {
        return applyPageAnchor(
          {
            pageIndex: anchor.pageIndex,
            pageX: anchor.pageX,
            pageY: anchor.pageY,
          },
          anchor.mouseX,
          anchor.mouseY,
          scale,
        );
      }

      container.scrollLeft = anchor.targetX - anchor.mouseX;
      container.scrollTop = anchor.targetY - anchor.mouseY;
      return true;
    },
    [applyPageAnchor, opts.containerRef],
  );

  const getPageIndexAtClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      if (typeof document.elementFromPoint !== "function") return null;
      const hitEl = document.elementFromPoint(
        clientX,
        clientY,
      ) as HTMLElement | null;
      const pageEl = hitEl?.closest?.('[id^="page-"]');
      if (!(pageEl instanceof HTMLElement) || !pageEl.id.startsWith("page-")) {
        return null;
      }

      const pageIndex = Number(pageEl.id.slice("page-".length));
      return Number.isNaN(pageIndex) ? null : pageIndex;
    },
    [],
  );

  const notifyPageIndexChange = useCallback(
    (pageIndex: number) => {
      if (lastNotifiedPageIndexRef.current === pageIndex) return;
      lastNotifiedPageIndexRef.current = pageIndex;
      opts.onPageIndexChange?.(pageIndex);
    },
    [opts.onPageIndexChange],
  );

  const findClosestPageIndexByLayoutRect = useCallback(
    (contentX: number, contentY: number) => {
      const getRect = opts.getPageRectByPageIndex;
      if (!getRect) return null;

      const candidates = opts.editorState.pages
        .map((page) => {
          const rect = getRect(page.pageIndex);
          if (!rect) return null;
          return {
            pageIndex: page.pageIndex,
            rect: {
              left: rect.left,
              top: rect.top,
              right:
                typeof rect.right === "number"
                  ? rect.right
                  : rect.left + rect.width,
              bottom:
                typeof rect.bottom === "number"
                  ? rect.bottom
                  : rect.top + rect.height,
            },
          };
        })
        .filter(Boolean) as Array<{
        pageIndex: number;
        rect: { left: number; top: number; right: number; bottom: number };
      }>;

      if (candidates.length === 0) return null;

      return (
        pickClosestRectCandidate(
          { x: contentX, y: contentY },
          candidates,
          (candidate) => candidate.rect,
        )?.pageIndex ?? null
      );
    },
    [opts.editorState.pages, opts.getPageRectByPageIndex],
  );

  const findPageNearPointByDom = useCallback(
    (clientX: number, clientY: number, probeDx: number, probeDy: number) => {
      const getHit = (x: number, y: number) => {
        const els =
          typeof document.elementsFromPoint === "function"
            ? document.elementsFromPoint(x, y)
            : [];
        for (const el of els) {
          const pageEl = (el as HTMLElement | null)?.closest?.('[id^="page-"]');
          if (pageEl instanceof HTMLElement && pageEl.id.startsWith("page-")) {
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

      return pickClosestRectCandidate(
        { x: clientX, y: clientY },
        candidates,
        (candidate) => candidate.rect,
      );
    },
    [],
  );

  const resolveDoubleLayoutViewportCenterPage = useCallback(
    (container: HTMLDivElement | HTMLElement) => {
      const rect = container.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const gapPx = WORKSPACE_BASE_PAGE_GAP_PX * opts.editorState.scale;
      const probe = Math.max(8, Math.min(256, gapPx / 2 + 4));

      const domHit = findPageNearPointByDom(centerX, centerY, probe, probe);
      if (domHit) {
        return {
          pageIndex: domHit.pageIndex,
          pageRect: domHit.rect,
        };
      }

      const fallbackPageIndex = findClosestPageIndexByLayoutRect(
        container.scrollLeft + container.clientWidth / 2,
        container.scrollTop + container.clientHeight / 2,
      );
      if (fallbackPageIndex === null) return null;

      return {
        pageIndex: fallbackPageIndex,
        pageRect: null,
      };
    },
    [
      findClosestPageIndexByLayoutRect,
      findPageNearPointByDom,
      opts.editorState.scale,
    ],
  );

  const getContentZoomAnchor = useCallback(
    (
      clientX: number,
      clientY: number,
      currentScale: number,
      newScale: number,
    ): WorkspaceContentZoomAnchor | null => {
      const container = opts.containerRef.current;
      const content = opts.contentRef.current;
      if (!container || !content) return null;

      const rect = container.getBoundingClientRect();
      const mouseX = clientX - rect.left;
      const mouseY = clientY - rect.top;
      const contentRect = content.getBoundingClientRect();
      const relX = clientX - contentRect.left;
      const relY = clientY - contentRect.top;

      let targetX = 0;
      let targetY = 0;

      if (opts.editorState.pageLayout !== "single") {
        const scaleRatio = newScale / currentScale;
        targetX = relX * scaleRatio;
        targetY = relY * scaleRatio;
      } else if (opts.editorState.pageFlow === "horizontal") {
        const scaleRatio = newScale / currentScale;
        targetX = relX * scaleRatio;
        targetY = relY * scaleRatio;
      } else {
        const paddingPx = WORKSPACE_BASE_PADDING_PX;
        const gapPx = WORKSPACE_BASE_PAGE_GAP_PX * currentScale;
        let accumulatedH = paddingPx;
        let fixedY = paddingPx;
        let scaledY = 0;

        if (relY < paddingPx) {
          fixedY = relY;
          scaledY = 0;
        } else {
          let found = false;
          for (let i = 0; i < opts.editorState.pages.length; i++) {
            const page = opts.editorState.pages[i];
            const pageH = page.height * currentScale;

            if (relY < accumulatedH + pageH) {
              scaledY += relY - accumulatedH;
              found = true;
              break;
            }
            accumulatedH += pageH;
            scaledY += pageH;

            if (i < opts.editorState.pages.length - 1) {
              if (relY < accumulatedH + gapPx) {
                scaledY += relY - accumulatedH;
                found = true;
                break;
              }
              accumulatedH += gapPx;
              scaledY += gapPx;
            }
          }

          if (!found) {
            fixedY += relY - accumulatedH;
          }
        }

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

        const scaleRatio = newScale / currentScale;
        targetX = scaledX * scaleRatio + fixedX;
        targetY = scaledY * scaleRatio + fixedY;
      }

      return {
        kind: "content",
        targetX,
        targetY,
        mouseX,
        mouseY,
      };
    },
    [
      opts.containerRef,
      opts.contentRef,
      opts.editorState.pageFlow,
      opts.editorState.pageLayout,
      opts.editorState.pages,
    ],
  );

  const getContainerMousePosition = useCallback(
    (clientX: number, clientY: number) => {
      const container = opts.containerRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      return {
        mouseX: clientX - rect.left,
        mouseY: clientY - rect.top,
      };
    },
    [opts.containerRef],
  );

  const getZoomAnchorAtClientPoint = useCallback(
    (
      clientX: number,
      clientY: number,
      currentScale: number,
      newScale: number,
    ): WorkspaceZoomAnchor | null => {
      const container = opts.containerRef.current;
      if (!container) return null;

      const rect = container.getBoundingClientRect();
      const mouseX = clientX - rect.left;
      const mouseY = clientY - rect.top;
      const gapPx = WORKSPACE_BASE_PAGE_GAP_PX * currentScale;
      const probe = Math.max(8, Math.min(256, gapPx / 2));

      const domHit =
        opts.editorState.pageLayout !== "single"
          ? findPageNearPointByDom(clientX, clientY, probe, probe)
          : opts.editorState.pageFlow === "horizontal"
            ? findPageNearPointByDom(clientX, clientY, probe, 0)
            : findPageNearPointByDom(clientX, clientY, 0, probe);

      if (domHit) {
        const { pageIndex, rect: pageRect } = domHit;
        const pageX = (clientX - pageRect.left) / currentScale;
        const pageY = (clientY - pageRect.top) / currentScale;
        const pageW = pageRect.width / currentScale;
        const pageH = pageRect.height / currentScale;

        return {
          kind: "page",
          pageIndex,
          pageX: Math.max(0, Math.min(pageW, pageX)),
          pageY: Math.max(0, Math.min(pageH, pageY)),
          mouseX,
          mouseY,
        };
      }

      return getContentZoomAnchor(clientX, clientY, currentScale, newScale);
    },
    [
      findPageNearPointByDom,
      getContentZoomAnchor,
      opts.containerRef,
      opts.editorState.pageFlow,
      opts.editorState.pageLayout,
    ],
  );

  const queueZoomCommit = useCallback(
    (options: {
      scale: number;
      anchor: WorkspaceZoomAnchor;
      source: WorkspaceZoomSource;
      fromScale: number;
    }) => {
      const nextScale = Number(clampWorkspaceScale(options.scale).toFixed(3));
      if (Math.abs(nextScale - options.fromScale) < 0.001) {
        return false;
      }

      if (opts.editorState.options.debugOptions.workspaceZoomJank) {
        appEventBus.emit("workspace:zoomInput", {
          at: performance.now(),
          source: options.source,
          fromScale: options.fromScale,
          targetScale: nextScale,
        });
      }

      pendingZoomCommitRef.current = {
        scale: nextScale,
        anchor: options.anchor,
      };

      if (typeof window !== "undefined" && zoomCommitRafRef.current === null) {
        zoomCommitRafRef.current = window.requestAnimationFrame(() => {
          zoomCommitRafRef.current = null;
          const pending = pendingZoomCommitRef.current;
          if (!pending) return;
          zoomAnchorRef.current = pending.anchor;
          pendingZoomCommitRef.current = null;
          opts.onScaleChange(pending.scale);
        });
      }

      return true;
    },
    [
      opts.editorState.options.debugOptions.workspaceZoomJank,
      opts.onScaleChange,
    ],
  );

  const zoomAtClientPoint = useCallback(
    (options: {
      clientX: number;
      clientY: number;
      newScale: number;
      source: WorkspaceZoomSource;
      fromScale?: number;
    }) => {
      // Wheel zoom anchors must be computed against the scale that is actually
      // on screen right now. A pending zoom commit may already have a newer
      // target scale, but the DOM/page rects still reflect the rendered scale.
      const currentScale = opts.editorState.scale;
      const nextScale = Number(
        clampWorkspaceScale(options.newScale).toFixed(3),
      );
      const fromScale = options.fromScale ?? currentScale;
      const anchor = getZoomAnchorAtClientPoint(
        options.clientX,
        options.clientY,
        currentScale,
        nextScale,
      );
      if (!anchor) return false;

      return queueZoomCommit({
        scale: nextScale,
        anchor,
        source: options.source,
        fromScale,
      });
    },
    [getZoomAnchorAtClientPoint, opts.editorState.scale, queueZoomCommit],
  );

  const zoomBetweenClientPoints = useCallback(
    (options: {
      anchorClientX: number;
      anchorClientY: number;
      targetClientX: number;
      targetClientY: number;
      newScale: number;
      source: WorkspaceZoomSource;
      fromScale?: number;
    }) => {
      const currentScale =
        pendingZoomCommitRef.current?.scale ?? opts.editorState.scale;
      const nextScale = Number(
        clampWorkspaceScale(options.newScale).toFixed(3),
      );
      const fromScale = options.fromScale ?? currentScale;
      const anchor = getZoomAnchorAtClientPoint(
        options.anchorClientX,
        options.anchorClientY,
        currentScale,
        nextScale,
      );
      const mousePosition = getContainerMousePosition(
        options.targetClientX,
        options.targetClientY,
      );
      if (!anchor || !mousePosition) return false;

      return queueZoomCommit({
        scale: nextScale,
        anchor: {
          ...anchor,
          mouseX: mousePosition.mouseX,
          mouseY: mousePosition.mouseY,
        },
        source: options.source,
        fromScale,
      });
    },
    [
      getContainerMousePosition,
      getZoomAnchorAtClientPoint,
      opts.editorState.scale,
      queueZoomCommit,
    ],
  );

  const panViewportBy = useCallback(
    (deltaX: number, deltaY: number) => {
      const container = opts.containerRef.current;
      if (!container) return;
      if (Math.abs(deltaX) < 0.01 && Math.abs(deltaY) < 0.01) return;

      container.scrollLeft -= deltaX;
      container.scrollTop -= deltaY;
      scrollPosRef.current = {
        x: container.scrollLeft,
        y: container.scrollTop,
      };
    },
    [opts.containerRef],
  );

  useLayoutEffect(() => {
    const container = opts.containerRef.current;
    const content = opts.contentRef.current;
    if (!container || !content) return;

    const pendingZoomAnchor = zoomAnchorRef.current;
    const previousScale = prevScaleRef.current;
    const scaleChanged = previousScale !== opts.editorState.scale;

    if (pendingZoomAnchor?.kind === "page") {
      pageIndexLockRef.current = pendingZoomAnchor.pageIndex;
    } else if (scaleChanged) {
      pageIndexLockRef.current =
        viewportAnchorRef.current?.pageIndex ??
        lastNotifiedPageIndexRef.current ??
        pageIndexLockRef.current;
    }

    if (pendingZoomAnchor) {
      applyZoomAnchor(pendingZoomAnchor, opts.editorState.scale);
      zoomAnchorRef.current = null;
    } else if (scaleChanged) {
      const rect = container.getBoundingClientRect();
      const viewportW = rect.width;
      const viewportH = rect.height;

      const pre = viewportAnchorRef.current;
      const usedPre =
        opts.editorState.pageLayout !== "single" &&
        pre &&
        Math.abs(pre.scale - previousScale) < 0.0001 &&
        applyPageAnchor(
          { pageIndex: pre.pageIndex, pageX: pre.pageX, pageY: pre.pageY },
          viewportW / 2,
          viewportH / 2,
          opts.editorState.scale,
        );

      if (!usedPre) {
        const oldScale = previousScale;
        const newScale = opts.editorState.scale;
        const scaleRatio = newScale / oldScale;
        const oldScrollLeft = scrollPosRef.current.x;
        const oldScrollTop = scrollPosRef.current.y;
        const centerXOld = oldScrollLeft + viewportW / 2;
        const centerYOld = oldScrollTop + viewportH / 2;
        const centerXNew = centerXOld * scaleRatio;
        const centerYNew = centerYOld * scaleRatio;
        container.scrollLeft = centerXNew - viewportW / 2;
        container.scrollTop = centerYNew - viewportH / 2;
      }
    }
    prevScaleRef.current = opts.editorState.scale;
    scrollPosRef.current = { x: container.scrollLeft, y: container.scrollTop };
  }, [
    applyPageAnchor,
    applyZoomAnchor,
    getPageIndexAtClientPoint,
    opts.containerRef,
    opts.contentRef,
    opts.editorState.pageLayout,
    opts.editorState.scale,
  ]);

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
        const currentScale = opts.editorState.scale;
        const baseScale = pendingZoomCommitRef.current?.scale ?? currentScale;
        const steps = -e.deltaY / 100;
        const newScale = baseScale * Math.pow(ZOOM_BASE, steps);

        void zoomAtClientPoint({
          clientX: e.clientX,
          clientY: e.clientY,
          newScale,
          source: "wheel",
          fromScale: currentScale,
        });
      }
    },
    [
      opts.containerRef,
      opts.editorState.scale,
      opts.isPanning,
      zoomAtClientPoint,
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

        if (shouldNotifyPageIndex) {
          const lockedPageIndex = pageIndexLockRef.current;
          if (typeof lockedPageIndex === "number") {
            const rect = c.getBoundingClientRect();
            const centerPageIndex = isDoubleLayout
              ? (resolveDoubleLayoutViewportCenterPage(c)?.pageIndex ?? null)
              : getPageIndexAtClientPoint(
                  rect.left + rect.width / 2,
                  rect.top + rect.height / 2,
                );

            if (
              centerPageIndex === null ||
              centerPageIndex === lockedPageIndex
            ) {
              notifyPageIndexChange(lockedPageIndex);
              return;
            }

            pageIndexLockRef.current = null;
          }
        }

        if (isDoubleLayout) {
          const resolvedCenterPage = resolveDoubleLayoutViewportCenterPage(c);
          if (!resolvedCenterPage) return;

          const idx = resolvedCenterPage.pageIndex;
          const r = resolvedCenterPage.pageRect;
          if (r) {
            const rect = c.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
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
          }
          if (shouldNotifyPageIndex) notifyPageIndexChange(idx);
          return;
        }

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
              notifyPageIndexChange(i);
              found = true;
              break;
            }

            if (
              middleX > currentX + pageWidth &&
              middleX < currentX + pageWidth + gap
            ) {
              if (middleX < currentX + pageWidth + gap / 2) {
                notifyPageIndexChange(i);
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
            notifyPageIndexChange(opts.editorState.pages.length - 1);
          }
          return;
        }

        const scrollTop = c.scrollTop;
        const viewportHeight = c.clientHeight;
        const middleY = scrollTop + viewportHeight / 2;

        let currentY = paddingPx;
        let found = false;

        for (let i = 0; i < opts.editorState.pages.length; i++) {
          const page = opts.editorState.pages[i];
          const pageHeight = page.height * scale;

          if (middleY >= currentY && middleY <= currentY + pageHeight) {
            notifyPageIndexChange(i);
            found = true;
            break;
          }

          if (
            middleY > currentY + pageHeight &&
            middleY < currentY + pageHeight + gap
          ) {
            if (middleY < currentY + pageHeight + gap / 2) {
              notifyPageIndexChange(i);
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
          notifyPageIndexChange(opts.editorState.pages.length - 1);
        }
      });
    }
  }, [
    opts.containerRef,
    opts.editorState.pageFlow,
    opts.editorState.pageLayout,
    opts.editorState.pages,
    opts.editorState.scale,
    findClosestPageIndexByLayoutRect,
    opts.getPageRectByPageIndex,
    opts.onPageIndexChange,
    opts.textSelectionToolbarVisible,
    opts.updateTextSelectionToolbar,
    getPageIndexAtClientPoint,
    notifyPageIndexChange,
    resolveDoubleLayoutViewportCenterPage,
  ]);

  useEffect(() => {
    if (opts.editorState.pendingViewStateRestore) {
      skipNextAutoCenterRef.current = true;
      return;
    }

    if (skipNextAutoCenterRef.current) {
      skipNextAutoCenterRef.current = false;
      return;
    }

    if (
      opts.containerRef.current &&
      opts.contentRef.current &&
      opts.editorState.pages.length > 0
    ) {
      const container = opts.containerRef.current;
      const content = opts.contentRef.current;

      if (opts.editorState.pageFlow === "horizontal") return;

      requestAnimationFrame(() => {
        const scrollLeft = (content.scrollWidth - container.clientWidth) / 2;
        if (scrollLeft > 0) {
          container.scrollLeft = scrollLeft;
        }
      });
    }
  }, [
    opts.containerRef,
    opts.contentRef,
    opts.editorState.pageFlow,
    opts.editorState.pages.length,
    opts.editorState.pendingViewStateRestore,
    opts.fitTrigger,
  ]);

  return {
    handleViewportScroll,
    panViewportBy,
    zoomAtClientPoint,
    zoomBetweenClientPoints,
  };
};
