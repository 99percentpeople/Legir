import React from "react";
import { AnnotationControlProps } from "../types";
import { cn } from "@/utils/cn";
import { Trash2, Palette, Pencil, MessageCircleMore } from "lucide-react";
import { ControlWrapper } from "../ControlWrapper";
import { Button } from "@/components/ui/button";
import { ColorPickerPopover } from "@/components/toolbar/ColorPickerPopover";
import { FloatingToolbar } from "../FloatingToolbar";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useMouse } from "@/hooks/useMouse";
import { getContrastColor } from "@/utils/colors";
import { AnnotationAskAiButton } from "./AnnotationAskAiButton";

export const CommentControl: React.FC<AnnotationControlProps> = (props) => {
  const { data, isSelected, onUpdate, onDelete, onEdit, onAskAi } = props;
  const { ref, x, y, width, height } = useMouse<HTMLDivElement>();

  // Ensure rect exists, otherwise default
  const rect = data.rect || { x: 0, y: 0, width: 30, height: 30 };
  const iconBaseSize = Math.min(rect.width, rect.height) * 0.6;

  return (
    <ControlWrapper {...props} showBorder={false}>
      <FloatingToolbar isVisible={isSelected}>
        <ColorPickerPopover
          paletteType="foreground"
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
          <Pencil size={16} />
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
            className={cn(
              "flex h-full w-full items-center justify-center overflow-hidden",
              "rounded shadow-sm transition-colors",
              isSelected && "ring-primary ring-1",
            )}
            style={{
              backgroundColor: data.color || "#fff",
              opacity: data.opacity ?? 1,
              border: "1px solid rgba(0,0,0,0.1)",
            }}
          >
            <MessageCircleMore
              size={24}
              className="text-foreground opacity-80"
              fill={data.color ? data.color : "none"}
              color={data.color ? getContrastColor(data.color) : "currentColor"}
              style={{
                width: `calc(${iconBaseSize}px * var(--scale, 1))`,
                height: `calc(${iconBaseSize}px * var(--scale, 1))`,
              }}
            />
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
