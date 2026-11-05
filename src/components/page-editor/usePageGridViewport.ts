import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  MIN_PAGE_THUMBNAIL_SCALE,
  MAX_PAGE_THUMBNAIL_SCALE,
} from "@/constants";
import { useEditorView, useEditorViewApi } from "@/store/useEditorView";
import { useViewportTouchGestures } from "@/hooks/useViewportTouchGestures";
import {
  clampViewportScale,
  normalizeViewportScale,
  wheelViewportScale,
} from "@/lib/viewportZoom";
import { getPageGridLayout } from "./pageGridLayout";

type GridZoomAnchor = { index: number; fraction: number; offset: number };
type PendingZoom = { base: number; scale: number; anchor: GridZoomAnchor };
const bounds = {
  minScale: MIN_PAGE_THUMBNAIL_SCALE,
  maxScale: MAX_PAGE_THUMBNAIL_SCALE,
};

export function usePageGridViewport(dragRef: RefObject<unknown>) {
  const store = useEditorViewApi();
  const scale = useEditorView((state) => state.pageThumbnailScale);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 800, height: 600, top: 0 });
  const layout = useMemo(
    () => getPageGridLayout(viewport.width, scale),
    [viewport.width, scale],
  );
  const layoutRef = useRef(layout);
  const previous = useRef<typeof layout | null>(null);
  const scrollTop = useRef(0);
  const zoomAnchor = useRef<GridZoomAnchor | null>(null);
  const pinchAnchor = useRef<GridZoomAnchor | null>(null);
  const pending = useRef<PendingZoom | null>(null);
  const frame = useRef<number | null>(null);
  const [isPinching, setIsPinching] = useState(false);
  const updateScroll = useCallback((top: number) => {
    scrollTop.current = top;
    setViewport((current) => {
      const { rowHeight } = layoutRef.current;
      // Pixel scrolling does not change the mounted cards until a row boundary.
      return Math.floor(current.top / rowHeight) ===
        Math.floor(top / rowHeight) &&
        Math.ceil((current.top + current.height) / rowHeight) ===
          Math.ceil((top + current.height) / rowHeight)
        ? current
        : { ...current, top };
    });
  }, []);

  const before = previous.current;
  const reflowing =
    !before ||
    before.columns !== layout.columns ||
    before.rowHeight !== layout.rowHeight;
  const anchor = zoomAnchor.current ?? {
    index: before
      ? Math.floor(scrollTop.current / before.rowHeight) * before.columns
      : store.getState().currentPageIndex,
    fraction: before
      ? (scrollTop.current % before.rowHeight) / before.rowHeight
      : 0,
    offset: 0,
  };
  // Render the destination window immediately. Rendering the old scroll offset
  // with new columns first would mount and request thumbnails for unrelated pages.
  const top = reflowing
    ? Math.max(
        0,
        Math.min(
          (Math.floor(anchor.index / layout.columns) + anchor.fraction) *
            layout.rowHeight -
            anchor.offset,
          Math.ceil(store.getState().pages.length / layout.columns) *
            layout.rowHeight -
            viewport.height,
        ),
      )
    : viewport.top;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const resize = () => {
      const width = el.clientWidth,
        height = el.clientHeight;
      if (!width) return;
      setViewport((current) =>
        current.width === width && current.height === height
          ? current
          : { ...current, width, height },
      );
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    layoutRef.current = layout;
    if (reflowing) {
      el.scrollTop = top;
      updateScroll(el.scrollTop);
    }
    previous.current = layout;
    zoomAnchor.current = null;
  }, [layout, reflowing, top, updateScroll]);

  const captureAnchor = useCallback(
    (x: number, y: number): GridZoomAnchor | null => {
      const el = scrollRef.current;
      if (!el) return null;
      const {
        columns,
        rowHeight,
        offset: gridOffset,
        cardWidth,
        columnGap,
      } = layoutRef.current;
      const rect = el.getBoundingClientRect();
      const offset = Math.max(0, Math.min(el.clientHeight, y - rect.top));
      const row = Math.floor((el.scrollTop + offset) / rowHeight);
      const column = Math.max(
        0,
        Math.min(
          columns - 1,
          Math.floor((x - rect.left - gridOffset) / (cardWidth + columnGap)),
        ),
      );
      return {
        index: Math.min(
          store.getState().pages.length - 1,
          row * columns + column,
        ),
        fraction: ((el.scrollTop + offset) % rowHeight) / rowHeight,
        offset,
      };
    },
    [store],
  );

  const queueZoom = useCallback(
    (scale: number, anchor: GridZoomAnchor) => {
      const current = store.getState();
      if (dragRef.current) return;
      current.deferThumbnailWarmup();
      pending.current = {
        scale: clampViewportScale(scale, bounds),
        base: current.pageThumbnailScale,
        anchor,
      };
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const next = pending.current;
        pending.current = null;
        const current = store.getState();
        const el = scrollRef.current;
        if (
          !next ||
          !el ||
          dragRef.current ||
          current.pageThumbnailScale !== next.base
        )
          return;
        const scale = normalizeViewportScale(next.scale, bounds);
        if (scale === next.base) {
          const { columns, rowHeight } = layoutRef.current;
          el.scrollTop =
            (Math.floor(next.anchor.index / columns) + next.anchor.fraction) *
              rowHeight -
            next.anchor.offset;
          updateScroll(el.scrollTop);
        } else {
          zoomAnchor.current = next.anchor;
          current.setPageThumbnailScale(scale);
        }
      });
    },
    [dragRef, store, updateScroll],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (dragRef.current) {
        pending.current = null;
        return;
      }
      const current = store.getState().pageThumbnailScale;
      const base =
        pending.current?.base === current ? pending.current.scale : current;
      const anchor = captureAnchor(event.clientX, event.clientY);
      if (anchor)
        queueZoom(wheelViewportScale(base, event, el.clientHeight), anchor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      pending.current = null;
    };
  }, [captureAnchor, dragRef, queueZoom, store]);

  const { shouldSuppressClick } = useViewportTouchGestures({
    containerRef: scrollRef,
    enabled: true,
    scale,
    ...bounds,
    // Native one-finger scrolling and long-press sorting remain available.
    panEnabled: false,
    canStartPinch: () => !dragRef.current,
    onPinchStateChange: setIsPinching,
    onPinchBegin: ({ clientX, clientY }) => {
      pinchAnchor.current = captureAnchor(clientX, clientY);
    },
    onPinchZoom: ({ clientY, newScale }) => {
      const el = scrollRef.current;
      const anchor = pinchAnchor.current;
      if (!el || !anchor) return;
      queueZoom(newScale, {
        ...anchor,
        offset: clientY - el.getBoundingClientRect().top,
      });
    },
    onPinchPan: (_dx, dy) => {
      const el = scrollRef.current;
      if (el) {
        el.scrollTop -= dy;
        updateScroll(el.scrollTop);
      }
    },
  });

  return {
    scrollRef,
    isPinching,
    shouldSuppressClick,
    viewport: { ...viewport, top },
    layout,
    layoutRef,
    updateScroll,
  };
}
