import React, { useMemo } from "react";
import { AnnotationControlProps } from "../types";
import { cn } from "@/utils/cn";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useMouse } from "@/hooks/useMouse";
import { Trash2, Palette, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FloatingToolbar } from "../FloatingToolbar";
import { ColorPickerPopover } from "@/components/toolbar/ColorPickerPopover";
import { ControlWrapper } from "../ControlWrapper";
import {
  getInkBoundingRect,
  getInkStrokes,
  getInkSvgPath,
} from "@/lib/inkGeometry";
import { getContrastColor } from "@/utils/colors";

export const InkControl: React.FC<AnnotationControlProps> = (props) => {
  const {
    data,
    onSelect,
    isSelected,
    isSelectable,
    onUpdate,
    onDelete,
    onEdit,
  } = props;
  const { ref, x, y, width, height } = useMouse<HTMLDivElement>();

  const strokes = useMemo(() => {
    return getInkStrokes(data);
  }, [data.points, data.strokes]);

  const bounds = useMemo(() => {
    const rect = data.rect || getInkBoundingRect(strokes, data.thickness);
    if (!rect) return null;
    return {
      ...rect,
      originX: rect.x,
      originY: rect.y,
    };
  }, [strokes, data.rect, data.thickness]);

  const pathData = useMemo(() => {
    if (data.svgPath) return data.svgPath;
    return getInkSvgPath(strokes) || "";
  }, [strokes, data.svgPath]);

  if (!bounds || !pathData) return null;

  const isInkHighlight = data.intent === "InkHighlight";

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
              {isSelected && !isInkHighlight && (
                <path
                  d={pathData}
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth={(data.thickness || 1) + 6}
                  strokeLinecap={
                    data.intent === "InkHighlight" ? "butt" : "round"
                  }
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
                strokeLinecap={
                  data.intent === "InkHighlight" ? "butt" : "round"
                }
                strokeLinejoin="round"
                opacity={
                  data.opacity ?? (data.intent === "InkHighlight" ? 0.35 : 1)
                }
                className="pointer-events-auto cursor-pointer transition-opacity"
                style={{
                  cursor: !isSelectable ? "inherit" : "pointer",
                  mixBlendMode:
                    data.intent === "InkHighlight" ? "multiply" : undefined,
                }}
                onPointerDown={(e) => {
                  if (!isSelectable) return;
                  if (e.button === 1) return;
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
                transform: `translate(${x - width / 2}px, ${y - height}px)`,
              }}
            >
              <div
                className={cn(
                  "dark bg-background text-foreground pointer-events-none rounded-md px-2 py-1 text-xs whitespace-pre-wrap opacity-80 shadow-sm",
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
