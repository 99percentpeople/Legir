import React from "react";
import { AnnotationControlProps } from "../types";
import { cn } from "@/utils/cn";
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
import { AnnotationAskAiButton } from "./AnnotationAskAiButton";

interface HighlightRectProps {
  r: { x: number; y: number; width: number; height: number };
  data: AnnotationControlProps["data"];
  isSelectable: boolean;
  onSelect: (id: string) => void;
  elementId?: string;
  keySuffix?: string;
  isSelected?: boolean;
  showToolbar?: boolean;
  onUpdate?: (id: string, updates: Partial<Annotation>) => void;
  onDelete?: (id: string) => void;
  onEdit?: (id: string) => void;
  onAskAi?: (id: string) => void;
  isAnnotationMode?: boolean;
  onPointerDown?: AnnotationControlProps["onPointerDown"];
}

interface HighlightPolygonProps {
  rects: { x: number; y: number; width: number; height: number }[];
  data: AnnotationControlProps["data"];
  isSelectable: boolean;
  onSelect: (id: string) => void;
  elementId?: string;
  isSelected?: boolean;
  showToolbar?: boolean;
  onUpdate?: (id: string, updates: Partial<Annotation>) => void;
  onDelete?: (id: string) => void;
  onEdit?: (id: string) => void;
  onAskAi?: (id: string) => void;
  isAnnotationMode?: boolean;
  onPointerDown?: AnnotationControlProps["onPointerDown"];
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
  isSelectable,
  onSelect,
  elementId,
  isSelected,
  showToolbar,
  onUpdate,
  onDelete,
  onEdit,
  onAskAi,
  isAnnotationMode = true,
  onPointerDown,
}) => {
  const { ref, x, y, width, height } = useMouse<HTMLDivElement>();

  return (
    <ControlWrapper
      id={data.id}
      isSelected={!!isSelected}
      isAnnotationMode={isAnnotationMode}
      isFormMode={false}
      isSelectable={isSelectable}
      onPointerDown={() => {}}
      onSelect={onSelect}
      onUpdate={onUpdate || (() => {})}
      customRect={r}
      customElementId={elementId}
      showBorder={isSelected}
      resizable={false}
      data={data}
      className={isSelected ? undefined : "pointer-events-none"}
    >
      <FloatingToolbar isVisible={!!showToolbar}>
        <ColorPickerPopover
          paletteType="background"
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

        <AnnotationAskAiButton annotation={data} onAskAi={onAskAi} />

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
            className="pointer-events-auto h-full w-full cursor-pointer transition-colors"
            style={{
              backgroundColor: data.color,
              opacity: data.opacity !== undefined ? data.opacity : 0.4,
              mixBlendMode: "multiply",
            }}
            onPointerDown={(e) => {
              if (!isSelectable) return;
              if (e.button === 1) return;
              e.stopPropagation();
              e.preventDefault();
              onSelect(data.id);
              if (isSelected) {
                onPointerDown?.(e);
              }
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
                transform: `translate(${x - width / 2}px, ${y - height}px)`,
              }}
            >
              <div
                className={cn(
                  "dark bg-background text-foreground pointer-events-none max-w-xs rounded-md px-2 py-1 text-xs wrap-break-word whitespace-pre-wrap opacity-80 shadow-sm",
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
  isSelectable,
  onSelect,
  elementId,
  isSelected,
  showToolbar,
  onUpdate,
  onDelete,
  onEdit,
  onAskAi,
  isAnnotationMode = true,
  onPointerDown,
}) => {
  const bounds = getRectBounds(rects);
  const d = rectsToPath(rects, { x: bounds.x, y: bounds.y });
  const { ref, x, y, width, height } = useMouse<SVGPathElement>();

  return (
    <ControlWrapper
      id={data.id}
      isSelected={!!isSelected}
      isAnnotationMode={isAnnotationMode}
      isFormMode={false}
      isSelectable={isSelectable}
      onPointerDown={() => {}}
      onSelect={onSelect}
      onUpdate={onUpdate || (() => {})}
      customRect={bounds}
      customElementId={elementId}
      showBorder={isSelected}
      resizable={false}
      data={data}
      className={isSelected ? undefined : "pointer-events-none"}
    >
      <FloatingToolbar isVisible={!!showToolbar}>
        <ColorPickerPopover
          paletteType="background"
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

        <AnnotationAskAiButton annotation={data} onAskAi={onAskAi} />

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
        <div className="pointer-events-none h-full w-full">
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${bounds.width} ${bounds.height}`}
            preserveAspectRatio="none"
            className="pointer-events-none"
          >
            <TooltipTrigger asChild>
              <path
                ref={ref}
                d={d}
                fill={data.color}
                opacity={data.opacity !== undefined ? data.opacity : 0.4}
                className="pointer-events-auto cursor-pointer"
                style={{ mixBlendMode: "multiply" }}
                onPointerDown={(e) => {
                  if (!isSelectable) return;
                  if (e.button === 1) return;
                  e.stopPropagation();
                  e.preventDefault();
                  onSelect(data.id);
                  if (isSelected) {
                    onPointerDown?.(e);
                  }
                }}
              />
            </TooltipTrigger>
          </svg>
        </div>
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
                  "dark bg-background text-foreground pointer-events-none max-w-xs rounded-md px-2 py-1 text-xs wrap-break-word whitespace-pre-wrap opacity-80 shadow-sm",
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
  onSelect,
  isSelectable,
  isSelected,
  onUpdate,
  onDelete,
  onEdit,
  onAskAi,
  isAnnotationMode,
  onPointerDown,
}) => {
  if (data.rects && data.rects.length > 0) {
    return (
      <HighlightPolygon
        rects={data.rects}
        data={data}
        isSelectable={isSelectable}
        onSelect={onSelect}
        elementId={`annotation-${data.id}`}
        isSelected={isSelected}
        showToolbar={isSelected}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onEdit={onEdit}
        onAskAi={onAskAi}
        isAnnotationMode={isAnnotationMode}
        onPointerDown={onPointerDown}
      />
    );
  } else if (data.rect) {
    return (
      <HighlightRect
        r={data.rect}
        data={data}
        isSelectable={isSelectable}
        onSelect={onSelect}
        elementId={`annotation-${data.id}`}
        isSelected={isSelected}
        showToolbar={isSelected}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onEdit={onEdit}
        onAskAi={onAskAi}
        isAnnotationMode={isAnnotationMode}
        onPointerDown={onPointerDown}
      />
    );
  }
  return null;
};
