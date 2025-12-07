import React, { useMemo } from "react";
import { AnnotationControlProps } from "../types";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useMouse } from "@/hooks/useMouse";

export const InkControl: React.FC<AnnotationControlProps> = ({
  data,
  scale,
  onSelect,
  isSelected,
  isSelectable,
}) => {
  const { ref, x, y } = useMouse<HTMLDivElement>();

  // Calculate bounding box
  const bounds = useMemo(() => {
    if (!data.points || data.points.length === 0) return null;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    data.points.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });

    // Add some padding
    const padding = (data.thickness || 1) / 2 + 2;
    return {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
      originX: minX - padding,
      originY: minY - padding,
    };
  }, [data.points, data.thickness]);

  // Construct path data relative to bounding box
  const pathData = useMemo(() => {
    if (!data.points || data.points.length < 2 || !bounds) return "";
    return (
      `M ${(data.points[0].x - bounds.originX) * scale} ${(data.points[0].y - bounds.originY) * scale} ` +
      data.points
        .slice(1)
        .map(
          (p) =>
            `L ${(p.x - bounds.originX) * scale} ${(p.y - bounds.originY) * scale}`,
        )
        .join(" ")
    );
  }, [data.points, bounds, scale]);

  if (!bounds || !data.points) return null;

  return (
    <Tooltip delayDuration={0} disableHoverableContent>
      <TooltipTrigger asChild>
        <div
          ref={ref}
          id={`annotation-${data.id}`}
          className="pointer-events-none absolute"
          style={{
            left: bounds.x * scale,
            top: bounds.y * scale,
            width: bounds.width * scale,
            height: bounds.height * scale,
          }}
        >
          <svg width="100%" height="100%" className="overflow-visible">
            <path
              d={pathData}
              fill="none"
              stroke={data.color || "#000000"}
              strokeWidth={(data.thickness || 1) * scale}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={data.opacity ?? 1}
              className="pointer-events-auto cursor-pointer transition-opacity"
              style={{ cursor: isSelectable ? "grab" : "pointer" }}
              onPointerDown={(e) => {
                if (isSelectable) return;
                e.stopPropagation();
                onSelect(data.id);
              }}
            />
          </svg>
          {isSelected && (
            <div className="pointer-events-none absolute inset-0 border border-dashed border-blue-500" />
          )}
        </div>
      </TooltipTrigger>
      {data.text && (
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            align="center"
            side="bottom"
            sideOffset={36}
            hideWhenDetached
            className="group z-50"
            style={{
              transform: `translate(${x - (bounds.width * scale) / 2}px, ${
                y - bounds.height * scale
              }px)`,
            }}
          >
            <div
              className={cn(
                "dark:bg-background dark:text-foreground pointer-events-none rounded-md px-2 py-1 text-xs whitespace-pre-wrap opacity-80 shadow-sm",
                "animate-in fade-in-0 zoom-in-95 group-data-[side=bottom]:slide-in-from-top-2 group-data-[side=left]:slide-in-from-right-2 group-data-[side=right]:slide-in-from-left-2 group-data-[side=top]:slide-in-from-bottom-2",
                "group-data-[state=closed]:animate-out group-data-[state=closed]:fade-out-0 group-data-[state=closed]:zoom-out-95",
              )}
            >
              {data.text}
            </div>
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      )}
    </Tooltip>
  );
};
