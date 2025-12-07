import React from "react";
import { cn } from "@/lib/utils";
import { ControlProps } from "./types";

export const ControlWrapper: React.FC<
  React.PropsWithChildren<ControlProps>
> = ({
  children,
  id,
  isSelected,
  scale,
  isFormMode,
  isAnnotationMode,
  isSelectable,
  onResizeStart,
  data,
  onPointerDown,
}) => {
  // Extract rect safely
  const rect = "rect" in data ? data.rect : undefined;

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
  const isAnnotation = ["comment", "highlight", "ink"].includes(data.type);
  const elementId = isAnnotation ? `annotation-${id}` : `field-element-${id}`;

  return (
    <div
      id={elementId}
      onPointerDown={(e) => {
        if (!isSelectable) return;
        onPointerDown?.(e);
      }}
      className={cn(
        "group pointer-events-auto absolute outline-none select-none",
        isSelected ? "z-50" : "hover:z-50",
      )}
      style={{
        left: rect.x * scale,
        top: rect.y * scale,
        width: rect.width * scale,
        height: rect.height * scale,
        // Cursor logic should be passed or handled by child/wrapper
        cursor: !isSelectable
          ? "inherit"
          : isFormMode
            ? isSelected
              ? "move"
              : "inherit"
            : "pointer", // Default to pointer for interaction
      }}
    >
      {children}

      {/* Selection Overlay (Form Mode Only) */}
      {isSelected && isFormMode && (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -inset-0.5 border-2 border-dashed border-blue-500" />
          <span className="absolute -top-6 left-0 z-30 rounded bg-blue-500 px-1.5 py-0.5 text-[10px] whitespace-nowrap text-white shadow-sm">
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
      )}

      {/* Annotation Mode Focus Overlay */}
      {isAnnotationMode && isSelected && (
        <div className="animate-in fade-in pointer-events-none absolute inset-0 z-50 border border-dashed border-blue-500 duration-200" />
      )}
    </div>
  );
};
