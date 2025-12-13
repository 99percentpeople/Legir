import React from "react";
import { AnnotationControlProps } from "../types";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useMouse } from "@/hooks/useMouse";
import { Trash2, Palette, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FloatingToolbar } from "../FloatingToolbar";
import { ColorPickerPopover } from "@/components/toolbar/ColorPickerPopover";
import { Annotation } from "@/types";
import { ControlWrapper } from "../ControlWrapper";
import { getContrastColor } from "@/utils/colors";

interface HighlightRectProps {
  r: { x: number; y: number; width: number; height: number };
  data: AnnotationControlProps["data"];
  scale: number;
  isSelectable: boolean;
  onSelect: (id: string) => void;
  elementId?: string;
  keySuffix?: string;
  isSelected?: boolean;
  showToolbar?: boolean;
  onUpdate?: (id: string, updates: Partial<Annotation>) => void;
  onDelete?: (id: string) => void;
  onEdit?: (id: string) => void;
  isAnnotationMode?: boolean;
}

interface HighlightPolygonProps {
  rects: { x: number; y: number; width: number; height: number }[];
  data: AnnotationControlProps["data"];
  scale: number;
  isSelectable: boolean;
  onSelect: (id: string) => void;
  elementId?: string;
  isSelected?: boolean;
  showToolbar?: boolean;
  onUpdate?: (id: string, updates: Partial<Annotation>) => void;
  onDelete?: (id: string) => void;
  onEdit?: (id: string) => void;
  isAnnotationMode?: boolean;
}

const getRectBounds = (
  rects: { x: number; y: number; width: number; height: number }[],
) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }

  return {
    x: Number.isFinite(minX) ? minX : 0,
    y: Number.isFinite(minY) ? minY : 0,
    width: Number.isFinite(maxX) ? Math.max(1, maxX - minX) : 1,
    height: Number.isFinite(maxY) ? Math.max(1, maxY - minY) : 1,
  };
};

const rectsToPath = (
  rects: { x: number; y: number; width: number; height: number }[],
  origin: { x: number; y: number },
) => {
  return rects
    .map((r) => {
      const x = r.x - origin.x;
      const y = r.y - origin.y;
      const w = r.width;
      const h = r.height;
      return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
    })
    .join(" ");
};

const HighlightRect: React.FC<HighlightRectProps> = ({
  r,
  data,
  scale,
  isSelectable,
  onSelect,
  elementId,
  isSelected,
  showToolbar,
  onUpdate,
  onDelete,
  onEdit,
  isAnnotationMode = true,
}) => {
  const { ref, x, y } = useMouse<HTMLDivElement>();

  return (
    <ControlWrapper
      id={data.id}
      isSelected={!!isSelected}
      scale={scale}
      isAnnotationMode={isAnnotationMode}
      isFormMode={false}
      isSelectable={isSelectable}
      onPointerDown={(e) => {
        if (!isSelectable) return;
        e.stopPropagation();
        e.preventDefault();
        onSelect(data.id);
      }}
      onSelect={onSelect}
      onUpdate={onUpdate || (() => {})}
      customRect={r}
      customElementId={elementId}
      showBorder={isSelected}
      resizable={false}
      data={data}
    >
      <FloatingToolbar isVisible={!!showToolbar}>
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

      <Tooltip delayDuration={0} disableHoverableContent>
        <TooltipTrigger asChild>
          <div
            ref={ref}
            className="h-full w-full transition-colors"
            style={{
              backgroundColor: data.color,
              opacity: data.opacity !== undefined ? data.opacity : 0.4,
              mixBlendMode: "multiply",
            }}
          />
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
                transform: `translate(${x - (r.width * scale) / 2}px, ${
                  y - r.height * scale
                }px)`,
              }}
            >
              <div
                className={cn(
                  "dark:bg-background dark:text-foreground pointer-events-none max-w-xs rounded-md px-2 py-1 text-xs break-words whitespace-pre-wrap opacity-80 shadow-sm",
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

const HighlightPolygon: React.FC<HighlightPolygonProps> = ({
  rects,
  data,
  scale,
  isSelectable,
  onSelect,
  elementId,
  isSelected,
  showToolbar,
  onUpdate,
  onDelete,
  onEdit,
  isAnnotationMode = true,
}) => {
  const bounds = getRectBounds(rects);
  const d = rectsToPath(rects, { x: bounds.x, y: bounds.y });
  const { ref, x, y } = useMouse<HTMLDivElement>();

  return (
    <ControlWrapper
      id={data.id}
      isSelected={!!isSelected}
      scale={scale}
      isAnnotationMode={isAnnotationMode}
      isFormMode={false}
      isSelectable={isSelectable}
      onPointerDown={(e) => {
        if (!isSelectable) return;
        e.stopPropagation();
        e.preventDefault();
        onSelect(data.id);
      }}
      onSelect={onSelect}
      onUpdate={onUpdate || (() => {})}
      customRect={bounds}
      customElementId={elementId}
      showBorder={isSelected}
      resizable={false}
      data={data}
    >
      <FloatingToolbar isVisible={!!showToolbar}>
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

      <Tooltip delayDuration={0} disableHoverableContent>
        <TooltipTrigger asChild>
          <div ref={ref} className="h-full w-full">
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${bounds.width} ${bounds.height}`}
              preserveAspectRatio="none"
              className="pointer-events-none"
            >
              <path
                d={d}
                fill={data.color}
                opacity={data.opacity !== undefined ? data.opacity : 0.4}
                style={{ mixBlendMode: "multiply" }}
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
                  "dark:bg-background dark:text-foreground pointer-events-none max-w-xs rounded-md px-2 py-1 text-xs break-words whitespace-pre-wrap opacity-80 shadow-sm",
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

export const HighlightControl: React.FC<AnnotationControlProps> = ({
  data,
  scale,
  onSelect,
  isSelectable,
  isSelected,
  onUpdate,
  onDelete,
  onEdit,
  isAnnotationMode,
  isFormMode,
}) => {
  if (data.rects && data.rects.length > 0) {
    return (
      <HighlightPolygon
        rects={data.rects}
        data={data}
        scale={scale}
        isSelectable={isSelectable}
        onSelect={onSelect}
        elementId={`annotation-${data.id}`}
        isSelected={isSelected}
        showToolbar={isSelected}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onEdit={onEdit}
        isAnnotationMode={isAnnotationMode}
      />
    );
  } else if (data.rect) {
    return (
      <HighlightRect
        r={data.rect}
        data={data}
        scale={scale}
        isSelectable={isSelectable}
        onSelect={onSelect}
        elementId={`annotation-${data.id}`}
        isSelected={isSelected}
        showToolbar={isSelected}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onEdit={onEdit}
        isAnnotationMode={isAnnotationMode}
      />
    );
  }
  return null;
};
