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
            showToolbar={isSelected && idx === 0}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onEdit={onEdit}
            isAnnotationMode={isAnnotationMode}
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
