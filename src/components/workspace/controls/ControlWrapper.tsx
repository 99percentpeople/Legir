import React from "react";
import { cn } from "@/lib/cn";
import { ControlProps } from "./types";
import { appEventBus } from "@/lib/eventBus";
import { useAppEvent } from "@/hooks/useAppEventBus";

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
  scale,
  isSelectable,
  onResizeStart,
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
    if (onResizeStart) {
      onResizeStart(handle, e);
    }
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

    const outerW = rect.width * scale;
    const outerH = rect.height * scale;
    const innerW = baseRect.width * scale;
    const innerH = baseRect.height * scale;
    const innerLeft = (outerW - innerW) / 2;
    const innerTop = (outerH - innerH) / 2;

    return { innerW, innerH, innerLeft, innerTop };
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

  return (
    <div
      ref={wrapperRef}
      id={elementId || undefined}
      onPointerDown={(e) => {
        if (!isSelectable) return;
        if (e.button === 1) return;
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
        left: rect.x * scale,
        top: rect.y * scale,
        width: rect.width * scale,
        height: rect.height * scale,
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
                <div className="absolute -inset-0.5 border-2 border-dashed border-blue-500" />
                <span className="absolute -top-6 left-0 z-30 rounded bg-blue-500 px-1.5 py-0.5 text-[10px] whitespace-nowrap shadow-sm">
                  {label}
                </span>
                <div
                  className="absolute"
                  style={{
                    left: rotatedInnerOverlayGeometry?.innerLeft,
                    top: rotatedInnerOverlayGeometry?.innerTop,
                    width: rotatedInnerOverlayGeometry?.innerW,
                    height: rotatedInnerOverlayGeometry?.innerH,
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
                    />
                  ))}

                  <div
                    className="pointer-events-auto absolute -top-6 left-1/2 z-30 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border border-blue-500 bg-white"
                    onPointerDown={(e) => handleResizePointerDown(e, "rotate")}
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
                  />
                ))}

                {data.type === "freetext" && (
                  <div
                    className="pointer-events-auto absolute -top-6 left-1/2 z-30 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border border-blue-500 bg-white"
                    onPointerDown={(e) => handleResizePointerDown(e, "rotate")}
                  />
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
