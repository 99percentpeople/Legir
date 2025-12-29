import { useRef, useCallback, useState, useEffect } from "react";
import { setGlobalCursor, resetGlobalCursor } from "@/lib/cursor";

interface UseCanvasPanningProps {
  containerRef: React.RefObject<HTMLElement>;
  editorState: {
    tool: string;
    keys: {
      space: boolean;
    };
  };
  capturePointer: (e: React.PointerEvent) => void;
  releasePointer: (
    e?: React.PointerEvent | React.MouseEvent | PointerEvent | Event,
  ) => void;
}

export const useCanvasPanning = ({
  containerRef,
  editorState,
  capturePointer,
  releasePointer,
}: UseCanvasPanningProps) => {
  const [isPanning, setIsPanning] = useState(false);
  // Track the source of the current pan operation: "space" key or "tool" selection
  const [panSource, setPanSource] = useState<"space" | "tool" | null>(null);

  const panStartRef = useRef<{
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  const rafIdRef = useRef<number | null>(null);
  const targetScrollRef = useRef<{ left: number; top: number } | null>(null);

  // Determine if panning mode is theoretically active (cursor should show grab)
  const isPanModeActive = editorState.tool === "pan" || editorState.keys.space;

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  const startPan = useCallback(
    (e: React.PointerEvent) => {
      // Only left click triggers pan
      if (e.button !== 0) return false;

      // Check if we should start panning
      const isSpacePan = editorState.keys.space;
      const isToolPan = editorState.tool === "pan";

      if (!isSpacePan && !isToolPan) return false;

      e.preventDefault();

      const source = isSpacePan ? "space" : "tool";
      setPanSource(source);
      setIsPanning(true);

      if (containerRef.current) {
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          scrollLeft: containerRef.current.scrollLeft,
          scrollTop: containerRef.current.scrollTop,
        };
      }

      setGlobalCursor("grabbing");
      capturePointer(e);
      return true;
    },
    [editorState.keys.space, editorState.tool, containerRef, capturePointer],
  );

  const movePan = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanning || !panStartRef.current || !containerRef.current)
        return false;

      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;

      const newScrollLeft = panStartRef.current.scrollLeft - dx;
      const newScrollTop = panStartRef.current.scrollTop - dy;

      // Store target for RAF
      targetScrollRef.current = { left: newScrollLeft, top: newScrollTop };

      if (!rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(() => {
          if (containerRef.current && targetScrollRef.current) {
            containerRef.current.scrollLeft = targetScrollRef.current.left;
            containerRef.current.scrollTop = targetScrollRef.current.top;
          }
          rafIdRef.current = null;
        });
      }

      return true;
    },
    [isPanning, containerRef],
  );

  const endPan = useCallback(
    (e?: React.PointerEvent | React.MouseEvent) => {
      if (!isPanning) return false;

      setIsPanning(false);
      setPanSource(null);
      panStartRef.current = null;
      targetScrollRef.current = null;

      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      // Reset cursor based on whether we are still in pan mode (tool) or not
      // If we are in "tool" mode, cursor should go back to "grab" (handled by CSS/style usually, but we reset global override)
      resetGlobalCursor();

      if (e) releasePointer(e);
      return true;
    },
    [isPanning, releasePointer],
  );

  return {
    isPanning,
    panSource,
    isPanModeActive,
    startPan,
    movePan,
    endPan,
  };
};
