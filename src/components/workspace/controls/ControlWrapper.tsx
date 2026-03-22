import React from "react";
import { cn } from "@/utils/cn";
import { ControlProps } from "./types";
import { appEventBus } from "@/lib/eventBus";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { getMoveDelta } from "@/lib/controlMovement";
import type { Annotation, FormField, MoveDirection } from "@/types";

export type ControlWrapperProps = ControlProps & {
  customRect?: { x: number; y: number; width: number; height: number };
  showBorder?: boolean;
  resizable?: boolean;
  customElementId?: string;
  className?: string;
  children?: React.ReactNode;
};

export const ControlWrapper: React.FC<ControlWrapperProps> = ({
  children,
  id,
  isSelected,
  isSelectable,
  onResizeStart,
  onUpdate,
  onTriggerHistorySave,
  data,
  onPointerDown,
  customRect,
  showBorder = false,
  resizable = false,
  customElementId,
  className,
}) => {
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const pendingFocusRef = React.useRef(false);
  const isFreetext = data.type === "freetext";

  useAppEvent(
    "workspace:focusControl",
    (payload) => {
      if (payload.id !== id) return;
      pendingFocusRef.current = true;
    },
    { replayLast: true },
  );

  const isAnnotation = [
    "comment",
    "highlight",
    "ink",
    "freetext",
    "link",
    "shape",
  ].includes(data.type);

  React.useEffect(() => {
    if (!isSelected) return;
    if (!pendingFocusRef.current) return;
    pendingFocusRef.current = false;

    const el = wrapperRef.current;
    if (!el) return;

    if (!isAnnotation) {
      const input = el.querySelector(
        "input, textarea, select, [contenteditable='true']",
      ) as HTMLElement | null;
      try {
        input?.focus({ preventScroll: true });
      } catch {
        try {
          input?.focus();
        } catch {
          // ignore
        }
      }
    }

    appEventBus.clearSticky("workspace:focusControl");
  }, [isSelected, isAnnotation]);

  // Extract rect safely
  const baseRect = "rect" in data ? data.rect : undefined;
  const rect = customRect || baseRect;

  if (!rect) return null; // Skip if no rect (e.g. ink might be handled differently)

  const handleResizePointerDown = (e: React.PointerEvent, handle: string) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).focus({ preventScroll: true });
    } catch {
      // ignore
    }
    if (onResizeStart) {
      onResizeStart(handle, e);
    }
  };

  const handleDirectionKey = (
    key: string,
  ): { direction: MoveDirection; dx: number; dy: number } | null => {
    let direction: MoveDirection;
    if (key === "ArrowUp") direction = "UP";
    else if (key === "ArrowDown") direction = "DOWN";
    else if (key === "ArrowLeft") direction = "LEFT";
    else if (key === "ArrowRight") direction = "RIGHT";
    else return null;

    const { dx, dy } = getMoveDelta(direction, false);
    return { direction, dx, dy };
  };

  const normalizeRotationDeg = (deg: number) => {
    if (!Number.isFinite(deg)) return 0;
    let next = deg % 360;
    if (next <= -180) next += 360;
    if (next > 180) next -= 360;
    return next;
  };

  const getFreetextInnerRectFromOuterAabb = (outerRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => {
    const rotationDeg =
      isFreetext &&
      typeof data.rotationDeg === "number" &&
      Number.isFinite(data.rotationDeg)
        ? data.rotationDeg
        : 0;

    if (rotationDeg === 0) {
      return outerRect;
    }

    const theta = (rotationDeg * Math.PI) / 180;
    const absCos = Math.abs(Math.cos(theta));
    const absSin = Math.abs(Math.sin(theta));
    const det = absCos * absCos - absSin * absSin;

    if (!Number.isFinite(det) || Math.abs(det) < 1e-6) {
      return outerRect;
    }

    const width = (outerRect.width * absCos - outerRect.height * absSin) / det;
    const height = (outerRect.height * absCos - outerRect.width * absSin) / det;

    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return outerRect;
    }

    const cx = outerRect.x + outerRect.width / 2;
    const cy = outerRect.y + outerRect.height / 2;

    return {
      x: cx - width / 2,
      y: cy - height / 2,
      width,
      height,
    };
  };

  const commitKeyboardRectUpdate = (nextRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => {
    const actualRect = isFreetext
      ? getFreetextInnerRectFromOuterAabb(nextRect)
      : nextRect;

    if (isAnnotation) {
      (onUpdate as (id: string, updates: Partial<Annotation>) => void)(id, {
        rect: actualRect,
      });
      return;
    }

    (onUpdate as (id: string, updates: Partial<FormField>) => void)(id, {
      rect: actualRect,
    });
  };

  const getKeyboardResizedRect = (handle: string, dx: number, dy: number) => {
    let nextX = rect.x;
    let nextY = rect.y;
    let nextW = rect.width;
    let nextH = rect.height;

    if (handle.includes("e")) nextW += dx;
    if (handle.includes("w")) {
      nextX += dx;
      nextW -= dx;
    }
    if (handle.includes("s")) nextH += dy;
    if (handle.includes("n")) {
      nextY += dy;
      nextH -= dy;
    }

    if (nextW < 5) {
      if (handle.includes("w")) nextX = rect.x + rect.width - 5;
      nextW = 5;
    }
    if (nextH < 5) {
      if (handle.includes("n")) nextY = rect.y + rect.height - 5;
      nextH = 5;
    }

    if (
      nextX === rect.x &&
      nextY === rect.y &&
      nextW === rect.width &&
      nextH === rect.height
    ) {
      return null;
    }

    return { x: nextX, y: nextY, width: nextW, height: nextH };
  };

  const handleResizeHandleKeyDown =
    (handle: string) => (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!resizable || !isSelected || handle === "rotate") return;
      const directionMeta = handleDirectionKey(e.key);
      if (!directionMeta) return;

      e.preventDefault();
      e.stopPropagation();

      const step = e.shiftKey ? 10 : 1;
      const dx = directionMeta.dx * step;
      const dy = directionMeta.dy * step;
      const nextRect = getKeyboardResizedRect(handle, dx, dy);
      if (!nextRect) return;

      if (!e.repeat) {
        onTriggerHistorySave?.();
      }

      commitKeyboardRectUpdate(nextRect);
    };

  const handleRotateHandleKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (!isFreetext || !isSelected) return;
    if (
      e.key !== "ArrowUp" &&
      e.key !== "ArrowDown" &&
      e.key !== "ArrowLeft" &&
      e.key !== "ArrowRight"
    ) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (!e.repeat) {
      onTriggerHistorySave?.();
    }

    const step = e.shiftKey ? 15 : 1;
    const delta = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -step : step;
    const currentRotation =
      typeof data.rotationDeg === "number" && Number.isFinite(data.rotationDeg)
        ? data.rotationDeg
        : 0;

    (onUpdate as (id: string, updates: Partial<Annotation>) => void)(id, {
      rotationDeg: normalizeRotationDeg(currentRotation + delta),
    });
  };

  // Get label for overlay
  const label = "name" in data ? (data as { name: string }).name : data.type;

  const rotationDeg =
    data.type === "freetext" &&
    "rotationDeg" in data &&
    typeof data.rotationDeg === "number" &&
    Number.isFinite(data.rotationDeg)
      ? data.rotationDeg
      : 0;
  const shouldRenderRotatedOverlay =
    data.type === "freetext" && rotationDeg !== 0;

  const rotatedInnerOverlayGeometry = (() => {
    if (!shouldRenderRotatedOverlay) return null;
    if (!baseRect) return null;

    const innerLeft = (rect.width - baseRect.width) / 2;
    const innerTop = (rect.height - baseRect.height) / 2;

    return {
      innerW: baseRect.width,
      innerH: baseRect.height,
      innerLeft,
      innerTop,
    };
  })();

  // Determine ID based on type for sidebar navigation
  const defaultElementId = isAnnotation
    ? `annotation-${id}`
    : `field-element-${id}`;
  const elementId =
    customElementId !== undefined ? customElementId : defaultElementId;

  const isInkHighlight =
    data.type === "ink" && "intent" in data && data.intent === "InkHighlight";
  const shouldRaiseZIndexOnHoverOrSelect =
    data.type !== "highlight" && !isInkHighlight;
  const supportsKeyboardResizeHandles = isSelected && resizable;

  return (
    <div
      ref={wrapperRef}
      id={elementId || undefined}
      onPointerDown={(e) => {
        if (!isSelectable) return;
        if (e.button !== 0) return;
        onPointerDown?.(e);
      }}
      className={cn(
        "group absolute outline-none select-none",
        isSelectable
          ? "pointer-events-auto"
          : "pointer-events-none **:pointer-events-none",
        shouldRaiseZIndexOnHoverOrSelect &&
          (isSelected ? "z-50" : "hover:z-50"),
        className,
      )}
      style={{
        left: `calc(${rect.x}px * var(--scale, 1))`,
        top: `calc(${rect.y}px * var(--scale, 1))`,
        width: `calc(${rect.width}px * var(--scale, 1))`,
        height: `calc(${rect.height}px * var(--scale, 1))`,
        cursor: isSelectable ? "pointer" : "inherit",
      }}
    >
      {children}

      {/* Selection Overlay */}
      {showBorder &&
        (resizable ? (
          /* Resizable Overlay */
          <div className="pointer-events-none absolute inset-0">
            {shouldRenderRotatedOverlay ? (
              <>
                <div className="absolute inset-px border border-dashed border-blue-500" />
                <span className="absolute -top-6 left-0 z-30 rounded bg-blue-500 px-1.5 py-0.5 text-[10px] whitespace-nowrap shadow-sm">
                  {label}
                </span>
                <div
                  className="absolute"
                  style={{
                    left: rotatedInnerOverlayGeometry
                      ? `calc(${rotatedInnerOverlayGeometry.innerLeft}px * var(--scale, 1))`
                      : undefined,
                    top: rotatedInnerOverlayGeometry
                      ? `calc(${rotatedInnerOverlayGeometry.innerTop}px * var(--scale, 1))`
                      : undefined,
                    width: rotatedInnerOverlayGeometry
                      ? `calc(${rotatedInnerOverlayGeometry.innerW}px * var(--scale, 1))`
                      : undefined,
                    height: rotatedInnerOverlayGeometry
                      ? `calc(${rotatedInnerOverlayGeometry.innerH}px * var(--scale, 1))`
                      : undefined,
                    transform: `rotate(${rotationDeg}deg)`,
                    transformOrigin: "50% 50%",
                  }}
                >
                  <div className="absolute -inset-0.5 border-2 border-dashed border-blue-500" />
                  {["nw", "ne", "sw", "se"].map((h) => (
                    <div
                      key={h}
                      className={cn(
                        "pointer-events-auto absolute z-30 h-3 w-3 border border-blue-500 bg-white",
                        h === "nw" && "-top-1.5 -left-1.5 cursor-nwse-resize",
                        h === "ne" && "-top-1.5 -right-1.5 cursor-nesw-resize",
                        h === "sw" &&
                          "-bottom-1.5 -left-1.5 cursor-nesw-resize",
                        h === "se" &&
                          "-right-1.5 -bottom-1.5 cursor-nwse-resize",
                      )}
                      onPointerDown={(e) => handleResizePointerDown(e, h)}
                      tabIndex={supportsKeyboardResizeHandles ? 0 : -1}
                      data-ff-keyboard-handle="control-resize"
                      aria-label={`${label} resize ${h}`}
                      onKeyDown={
                        supportsKeyboardResizeHandles
                          ? handleResizeHandleKeyDown(h)
                          : undefined
                      }
                    />
                  ))}

                  <div className="pointer-events-none absolute -top-3 left-1/2 z-20 h-3 w-0 -translate-x-1/2 border-l border-dashed border-blue-500" />
                  <div
                    className="pointer-events-auto absolute -top-6 left-1/2 z-30 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border border-blue-500 bg-white"
                    onPointerDown={(e) => handleResizePointerDown(e, "rotate")}
                    tabIndex={isFreetext ? 0 : -1}
                    data-ff-keyboard-handle="freetext-rotate"
                    aria-label={`${label} rotate`}
                    onKeyDown={
                      isFreetext ? handleRotateHandleKeyDown : undefined
                    }
                  />
                </div>
              </>
            ) : (
              <>
                <div className="absolute -inset-0.5 border-2 border-dashed border-blue-500" />
                <span className="absolute -top-6 left-0 z-30 rounded bg-blue-500 px-1.5 py-0.5 text-[10px] whitespace-nowrap shadow-sm">
                  {label}
                </span>
                {["nw", "ne", "sw", "se"].map((h) => (
                  <div
                    key={h}
                    className={cn(
                      "pointer-events-auto absolute z-30 h-3 w-3 border border-blue-500 bg-white",
                      h === "nw" && "-top-1.5 -left-1.5 cursor-nwse-resize",
                      h === "ne" && "-top-1.5 -right-1.5 cursor-nesw-resize",
                      h === "sw" && "-bottom-1.5 -left-1.5 cursor-nesw-resize",
                      h === "se" && "-right-1.5 -bottom-1.5 cursor-nwse-resize",
                    )}
                    onPointerDown={(e) => handleResizePointerDown(e, h)}
                    tabIndex={supportsKeyboardResizeHandles ? 0 : -1}
                    data-ff-keyboard-handle="control-resize"
                    aria-label={`${label} resize ${h}`}
                    onKeyDown={
                      supportsKeyboardResizeHandles
                        ? handleResizeHandleKeyDown(h)
                        : undefined
                    }
                  />
                ))}

                {data.type === "freetext" && (
                  <>
                    <div className="pointer-events-none absolute -top-3 left-1/2 z-20 h-3 w-0 -translate-x-1/2 border-l border-dashed border-blue-500" />
                    <div
                      className="pointer-events-auto absolute -top-6 left-1/2 z-30 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border border-blue-500 bg-white"
                      onPointerDown={(e) =>
                        handleResizePointerDown(e, "rotate")
                      }
                      tabIndex={0}
                      data-ff-keyboard-handle="freetext-rotate"
                      aria-label={`${label} rotate`}
                      onKeyDown={handleRotateHandleKeyDown}
                    />
                  </>
                )}
              </>
            )}
          </div>
        ) : (
          /* Non-Resizable Annotation Focus Overlay */
          <div className="pointer-events-none absolute inset-0 z-50 border border-dashed border-blue-500" />
        ))}
    </div>
  );
};
