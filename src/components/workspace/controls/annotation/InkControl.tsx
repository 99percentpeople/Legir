import React, { useMemo } from "react";
import { AnnotationControlProps } from "../types";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useMouse } from "@/hooks/useMouse";
import { Trash2, Palette, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FloatingToolbar } from "../FloatingToolbar";
import { ColorPickerPopover } from "@/components/toolbar/ColorPickerPopover";
import { ControlWrapper } from "../ControlWrapper";
import { getContrastColor } from "@/utils/colors";

export const InkControl: React.FC<AnnotationControlProps> = (props) => {
  const {
    data,
    scale,
    onSelect,
    isSelected,
    isSelectable,
    onUpdate,
    onDelete,
    onEdit,
  } = props;
  const { ref, x, y } = useMouse<HTMLDivElement>();

  const strokes = useMemo(() => {
    if (data.strokes && data.strokes.length > 0) return data.strokes;
    if (data.points && data.points.length > 0) return [data.points];
    return [];
  }, [data.points, data.strokes]);

  // Calculate bounding box
  const bounds = useMemo(() => {
    if (strokes.length === 0) return null;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    strokes.forEach((stroke) => {
      stroke.forEach((p) => {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      });
    });

    // Add some padding
    const padding = (data.thickness || 1) / 2;
    return {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
      originX: minX - padding,
      originY: minY - padding,
    };
  }, [strokes, data.thickness]);

  // Construct path data relative to bounding box
  const pathData = useMemo(() => {
    // Optimization: If we have an AP stream (svgPath), we don't need to calculate the path from points
    if (data.svgPath) return data.svgPath;
    if (strokes.length === 0 || !bounds) return "";

    const strokeToPath = (points: { x: number; y: number }[]) => {
      if (points.length < 2) return "";
      let d = `M ${points[0].x} ${points[0].y}`;

      // Use quadratic curves for smooth ink
      for (let i = 1; i < points.length - 1; i++) {
        const p = points[i];
        const nextP = points[i + 1];
        const midX = (p.x + nextP.x) / 2;
        const midY = (p.y + nextP.y) / 2;
        d += ` Q ${p.x} ${p.y}, ${midX} ${midY}`;
      }

      const lastP = points[points.length - 1];
      d += ` L ${lastP.x} ${lastP.y}`;
      return d;
    };

    return strokes
      .map((s) => strokeToPath(s))
      .filter(Boolean)
      .join(" ");
  }, [strokes, bounds, data.svgPath]);

  if (!bounds || strokes.length === 0) return null;

  return (
    <ControlWrapper
      {...props}
      customRect={bounds}
      className="pointer-events-none"
      showBorder={isSelected}
      resizable={false}
    >
      <Tooltip delayDuration={0} disableHoverableContent>
        <TooltipTrigger asChild>
          <div ref={ref} className="h-full w-full">
            <FloatingToolbar
              isVisible={isSelected}
              className="pointer-events-auto"
            >
              <ColorPickerPopover
                color={data.color || "#000000"}
                onColorChange={(c) => onUpdate?.(data.id, { color: c })}
                showThickness={false}
                side="top"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  style={{
                    backgroundColor: getContrastColor(data.color),
                  }}
                >
                  <Palette size={16} style={{ color: data.color }} />
                </Button>
              </ColorPickerPopover>

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => onEdit?.(data.id)}
                title="Edit Comment"
              >
                <MessageSquare size={16} />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8"
                onClick={() => onDelete?.(data.id)}
              >
                <Trash2 size={16} />
              </Button>
            </FloatingToolbar>

            <svg
              width="100%"
              height="100%"
              className="overflow-visible"
              viewBox={`${bounds.originX} ${bounds.originY} ${bounds.width} ${bounds.height}`}
            >
              {isSelected && (
                <path
                  d={pathData}
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth={(data.thickness || 1) + 6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.25}
                  className="pointer-events-none"
                />
              )}
              <path
                d={pathData}
                fill="none"
                stroke={data.color || "#000000"}
                strokeWidth={data.thickness || 1}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={data.opacity ?? 1}
                className="pointer-events-auto cursor-pointer transition-opacity"
                style={{ cursor: !isSelectable ? "inherit" : "pointer" }}
                onPointerDown={(e) => {
                  if (!isSelectable) return;
                  e.stopPropagation();
                  onSelect(data.id);
                  props.onPointerDown?.(e);
                }}
              />
            </svg>
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
    </ControlWrapper>
  );
};
