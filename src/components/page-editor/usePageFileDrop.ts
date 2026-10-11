import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type DragEvent,
} from "react";
import {
  hasPlatformFileTransfer,
  readPlatformDroppedPdfs,
  type PlatformDroppedPdf,
} from "@/services/platform";
import { fileInsertionIndex } from "./pageDrag";

export function usePageFileDrop({
  scrollRef,
  columns,
  rowHeight,
  total,
  enabled,
  onDrop,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  columns: number;
  rowHeight: number;
  total: number;
  enabled: boolean;
  onDrop: (files: Promise<PlatformDroppedPdf[]>, index: number) => void;
}) {
  const [fileDropIndex, setFileDropIndex] = useState<number | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const indexAt = (x: number, y: number) => {
    const el = scrollRef.current;
    if (!el) return total;
    const rect = el.getBoundingClientRect();
    return fileInsertionIndex(
      x - rect.left,
      y - rect.top + el.scrollTop,
      el.clientWidth,
      columns,
      total,
      rowHeight,
    );
  };
  const active = fileDropIndex !== null;
  useEffect(() => {
    if (!active) return;
    let frame: number;
    const scroll = () => {
      const el = scrollRef.current;
      const point = pointer.current;
      if (el && point) {
        const rect = el.getBoundingClientRect();
        const edge = 56;
        const velocity =
          point.y < rect.top + edge
            ? -Math.min(16, (rect.top + edge - point.y) / 3)
            : point.y > rect.bottom - edge
              ? Math.min(16, (point.y - rect.bottom + edge) / 3)
              : 0;
        if (velocity) {
          el.scrollTop += velocity;
          setFileDropIndex(
            fileInsertionIndex(
              point.x - rect.left,
              point.y - rect.top + el.scrollTop,
              el.clientWidth,
              columns,
              total,
              rowHeight,
            ),
          );
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [active, columns, rowHeight, total, scrollRef]);
  const reset = () => {
    pointer.current = null;
    setFileDropIndex(null);
  };
  const over = (event: DragEvent<HTMLDivElement>) => {
    if (!hasPlatformFileTransfer(event.nativeEvent)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = enabled ? "copy" : "none";
    if (!enabled) return;
    pointer.current = { x: event.clientX, y: event.clientY };
    setFileDropIndex(indexAt(event.clientX, event.clientY));
  };
  return {
    fileDropIndex,
    fileDropProps: {
      onDragEnter: over,
      onDragOver: over,
      onDragLeave: (event: DragEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          reset();
      },
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        if (!hasPlatformFileTransfer(event.nativeEvent)) return;
        event.preventDefault();
        event.stopPropagation();
        const index = indexAt(event.clientX, event.clientY);
        reset();
        // Read the browser's protected transfer immediately, before any await.
        if (enabled) onDrop(readPlatformDroppedPdfs(event.nativeEvent), index);
      },
    },
  };
}
