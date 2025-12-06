import React from "react";
import { AnnotationControlProps } from "../types";
import { cn } from "@/lib/utils";
import { MessageSquareText, Trash2, Palette, Pencil } from "lucide-react";
import { ControlWrapper } from "../ControlWrapper";
import { Button } from "@/components/ui/button";
import { ColorPickerPopover } from "@/components/toolbar/ColorPickerPopover";
import { FloatingToolbar } from "../FloatingToolbar";

export const CommentControl: React.FC<AnnotationControlProps> = (props) => {
  const { data, scale, isSelected, onUpdate, onDelete, onEdit } = props;

  // Ensure rect exists, otherwise default
  const rect = data.rect || { x: 0, y: 0, width: 30, height: 30 };

  return (
    <ControlWrapper {...props}>
      <FloatingToolbar isVisible={isSelected}>
        <ColorPickerPopover
          color={data.color || "#000000"}
          onColorChange={(c) => onUpdate?.(data.id, { color: c })}
          showThickness={false}
        >
          <Button variant="ghost" size="icon" className="h-8 w-8">
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

        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8"
          onClick={() => onDelete?.(data.id)}
        >
          <Trash2 size={16} />
        </Button>
      </FloatingToolbar>

      <div
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
        <MessageSquareText
          size={Math.min(rect.width, rect.height) * scale * 0.6}
          className="text-foreground opacity-80"
          fill={data.color ? data.color : "none"}
          color={data.color ? "white" : "currentColor"}
        />
      </div>
    </ControlWrapper>
  );
};
