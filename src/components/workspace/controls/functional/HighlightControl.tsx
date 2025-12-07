import React from "react";
import { AnnotationControlProps } from "../types";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useMouse } from "@/hooks/useMouse";

interface HighlightRectProps {
  r: { x: number; y: number; width: number; height: number };
  data: AnnotationControlProps["data"];
  scale: number;
  isSelectable: boolean;
  onSelect: (id: string) => void;
  elementId?: string;
  keySuffix?: string;
  isSelected?: boolean;
}

const HighlightRect: React.FC<HighlightRectProps> = ({
  r,
  data,
  scale,
  isSelectable,
  onSelect,
  elementId,
  isSelected,
}) => {
  const { ref, x, y } = useMouse<HTMLDivElement>();

  return (
    <Tooltip delayDuration={0} disableHoverableContent>
      <TooltipTrigger asChild>
        <div
          ref={ref}
          id={elementId}
          className={cn("pointer-events-auto absolute")}
          style={{
            left: r.x * scale,
            top: r.y * scale,
            width: r.width * scale,
            height: r.height * scale,
            cursor: isSelectable ? "grab" : "inherit",
          }}
          onPointerDown={(e) => {
            if (isSelectable) return;
            e.stopPropagation();
            e.preventDefault();
            onSelect(data.id);
          }}
        >
          <div
            className="absolute inset-0 transition-colors"
            style={{
              backgroundColor: data.color,
              opacity: data.opacity !== undefined ? data.opacity : 0.4,
              mixBlendMode: "multiply",
            }}
          />
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
              transform: `translate(${x - (r.width * scale) / 2}px, ${
                y - r.height * scale
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

export const HighlightControl: React.FC<AnnotationControlProps> = ({
  data,
  scale,
  onSelect,
  isSelectable,
  isSelected,
}) => {
  if (data.rects && data.rects.length > 0) {
    return (
      <React.Fragment>
        {data.rects.map((r, idx) => (
          <HighlightRect
            key={data.id + `_part_${idx}`}
            r={r}
            data={data}
            scale={scale}
            isSelectable={isSelectable}
            onSelect={onSelect}
            elementId={idx === 0 ? `annotation-${data.id}` : undefined}
            isSelected={isSelected}
          />
        ))}
      </React.Fragment>
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
      />
    );
  }
  return null;
};
