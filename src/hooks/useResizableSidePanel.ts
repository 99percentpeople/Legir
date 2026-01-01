import React from "react";
import { setGlobalCursor, resetGlobalCursor } from "@/lib/cursor";
import { useEventListener } from "@/hooks/useEventListener";

export type ResizableSide = "left" | "right";

export interface UseResizableSidePanelOptions {
  side: ResizableSide;
  isOpen: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;

  onResize: (width: number) => void;
  onCollapse?: () => void;
  onExpand?: () => void;

  collapseThresholdPx?: number;
  expandThresholdPx?: number;

  cursorSource: string;
}

const clamp = (v: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, v));
};

export function useResizableSidePanel({
  side,
  isOpen,
  width,
  minWidth,
  maxWidth,
  onResize,
  onCollapse,
  onExpand,
  collapseThresholdPx = 80,
  expandThresholdPx = 16,
  cursorSource,
}: UseResizableSidePanelOptions) {
  const [isResizing, setIsResizing] = React.useState(false);

  const resizeStateRef = React.useRef<{
    startX: number;
    startWidth: number;
    wasOpen: boolean;
    collapseArmed: boolean;
  } | null>(null);

  const onResizeRef = React.useRef(onResize);
  const onCollapseRef = React.useRef(onCollapse);
  const onExpandRef = React.useRef(onExpand);

  onResizeRef.current = onResize;
  onCollapseRef.current = onCollapse;
  onExpandRef.current = onExpand;

  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeStateRef.current = {
        startX: e.clientX,
        startWidth: isOpen ? width : 0,
        wasOpen: isOpen,
        collapseArmed: isOpen,
      };
      setIsResizing(true);
    },
    [isOpen, width],
  );

  useEventListener<MouseEvent>(
    isResizing ? document : null,
    "mousemove",
    (moveEvent) => {
      if (!resizeStateRef.current) return;

      const state = resizeStateRef.current;

      const rawWidth =
        side === "left"
          ? state.startWidth + (moveEvent.clientX - state.startX)
          : state.startWidth + (state.startX - moveEvent.clientX);

      if (state.wasOpen) {
        // When we just expanded from the closed state, the pointer may still be far
        // from the panel's minWidth edge. Keep the width clamped to minWidth until
        // the pointer reaches it, and don't allow collapse until then.
        if (!state.collapseArmed && rawWidth >= minWidth) {
          state.collapseArmed = true;
        }

        if (state.collapseArmed && rawWidth <= collapseThresholdPx) {
          if (onCollapseRef.current) onCollapseRef.current();

          state.wasOpen = false;
          state.collapseArmed = false;
          state.startWidth = 0;
          // After collapsing, anchor startX to the real panel edge so the "dead zone"
          // matches minWidth (distance from the edge), not the collapse pointer position.
          state.startX =
            side === "left"
              ? moveEvent.clientX - rawWidth
              : moveEvent.clientX + rawWidth;
          return;
        }

        onResizeRef.current(clamp(rawWidth, minWidth, maxWidth));
        return;
      }

      const expandDeadZonePx = Math.max(expandThresholdPx, minWidth);

      // closed: only expand once user drags beyond the dead zone
      if (rawWidth >= expandDeadZonePx) {
        if (onExpandRef.current) onExpandRef.current();

        state.wasOpen = true;

        // Keep startX anchored at the original edge so width won't "run ahead" of
        // the pointer. The clamp will hold width at minWidth until the pointer
        // reaches it.
        state.startWidth = 0;
        state.collapseArmed = true;

        onResizeRef.current(clamp(rawWidth, minWidth, maxWidth));
      }
    },
  );

  const endResize = React.useCallback(() => {
    setIsResizing(false);
    resizeStateRef.current = null;
  }, []);

  useEventListener(isResizing ? document : null, "mouseup", endResize);

  React.useEffect(() => {
    if (!isResizing) return;

    setGlobalCursor("col-resize", cursorSource);
    document.body.style.userSelect = "none";

    return () => {
      resetGlobalCursor(cursorSource);
      document.body.style.removeProperty("user-select");
    };
  }, [cursorSource, isResizing]);

  return {
    isResizing,
    handleMouseDown,
  };
}
