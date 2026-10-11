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
  ZOOM_BASE,
} from "@/constants";
import { useEditorView, useEditorViewApi } from "@/store/useEditorView";
import { getPageGridLayout } from "./pageGridLayout";

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
  const zoomAnchor = useRef<{
    index: number;
    fraction: number;
    offset: number;
  } | null>(null);
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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame: number | undefined;
    let pending: { scale: number; base: number; x: number; y: number } | null =
      null;
    const zoom = () => {
      frame = undefined;
      const next = pending;
      pending = null;
      const current = store.getState();
      if (
        !next ||
        dragRef.current ||
        current.pageThumbnailScale !== next.base ||
        next.scale === next.base
      )
        return;
      const {
        columns,
        rowHeight,
        offset: gridOffset,
        cardWidth,
        columnGap,
      } = layoutRef.current;
      const rect = el.getBoundingClientRect();
      const offset = Math.max(0, Math.min(el.clientHeight, next.y - rect.top));
      const row = Math.floor((el.scrollTop + offset) / rowHeight);
      const column = Math.max(
        0,
        Math.min(
          columns - 1,
          Math.floor(
            (next.x - rect.left - gridOffset) / (cardWidth + columnGap),
          ),
        ),
      );
      zoomAnchor.current = {
        index: Math.min(current.pages.length - 1, row * columns + column),
        fraction: ((el.scrollTop + offset) % rowHeight) / rowHeight,
        offset,
      };
      current.setPageThumbnailScale(next.scale);
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (dragRef.current) {
        pending = null;
        return;
      }
      store.getState().deferThumbnailWarmup();
      const current = store.getState();
      const scale =
        pending?.base === current.pageThumbnailScale
          ? pending.scale
          : current.pageThumbnailScale;
      const pixels =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? el.clientHeight
            : 1);
      const next = Math.max(
        MIN_PAGE_THUMBNAIL_SCALE,
        Math.min(
          MAX_PAGE_THUMBNAIL_SCALE,
          scale *
            Math.pow(ZOOM_BASE, -Math.max(-200, Math.min(200, pixels)) / 100),
        ),
      );
      pending = {
        scale: next,
        base: current.pageThumbnailScale,
        x: event.clientX,
        y: event.clientY,
      };
      if (frame === undefined) frame = requestAnimationFrame(zoom);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [dragRef, store]);

  return {
    scrollRef,
    viewport: { ...viewport, top },
    layout,
    layoutRef,
    updateScroll,
  };
}
