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
  const focusInputRef = React.useRef(true);

  useAppEvent(
    "workspace:focusControl",
    (payload) => {
      if (payload.id !== id) return;
      pendingFocusRef.current = true;
      focusInputRef.current = payload.focusInput !== false;
    },
    { replayLast: true },
  );

  React.useEffect(() => {
    if (!isSelected) return;
    if (!pendingFocusRef.current) return;
    pendingFocusRef.current = false;

    const el = wrapperRef.current;
    if (!el) return;

    el.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });

    if (focusInputRef.current) {
      const input = el.querySelector(
        "input, textarea, select, [contenteditable='true']",
      ) as HTMLElement | null;
      try {
        (input as any)?.focus?.({ preventScroll: true });
      } catch {
        try {
          input?.focus();
        } catch {
          // ignore
        }
      }
    }

    appEventBus.clearSticky("workspace:focusControl");
  }, [isSelected]);

  // Extract rect safely
  const rect = customRect || ("rect" in data ? data.rect : undefined);

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

  // Determine ID based on type for sidebar navigation
  const isAnnotation = ["comment", "highlight", "ink", "freetext"].includes(
    data.type,
  );
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
            <div className="absolute -inset-0.5 border-2 border-dashed border-blue-500" />
            <span className="absolute -top-6 left-0 z-30 rounded bg-blue-500 px-1.5 py-0.5 text-[10px] whitespace-nowrap shadow-sm">
              {label}
            </span>
            {/* Resize Handles */}
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
          </div>
        ) : (
          /* Non-Resizable Annotation Focus Overlay */
          <div className="pointer-events-none absolute inset-0 z-50 border border-dashed border-blue-500" />
        ))}
    </div>
  );
};
