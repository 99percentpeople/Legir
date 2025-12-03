import React from "react";
import { Edit2, Trash2, Palette } from "lucide-react";
import { Annotation } from "../../types";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "../../lib/utils";

const PEN_COLORS = [
  // Row 1
  "#000000",
  "#58595b",
  "#808285",
  "#a7a9ac",
  "#d1d3d4",
  "#ffffff",
  // Row 2
  "#b31564",
  "#e61b1b",
  "#ff5500",
  "#ffaa00",
  "#ffce00",
  "#ffe600",
  // Row 3
  "#a2e61b",
  "#26e600",
  "#008055",
  "#008055",
  "#004de6",
  "#3d00b8",
  // Row 4
  "#6600cc",
  "#600080",
  "#f7d7c4",
  "#bb9167",
  "#8e562e",
  "#613d30",
  // Row 5
  "#ff80ff",
  "#ffc680",
  "#ffff80",
  "#80ff9e",
  "#80d6ff",
  "#bcb3ff",
];

interface AnnotationToolbarProps {
  annotation: Annotation;
  onUpdate?: (updates: Partial<Annotation>) => void;
  onDelete?: () => void;
  onEdit?: () => void;
  scale: number;
}

export const AnnotationToolbar: React.FC<AnnotationToolbarProps> = ({
  annotation,
  onUpdate,
  onDelete,
  onEdit,
  scale,
}) => {
  // Only render for comments currently
  if (annotation.type !== "comment") return null;

  return (
    <div
      className="mb-2 flex items-center gap-1 p-1 bg-background border border-border rounded-md shadow-md animate-in fade-in zoom-in-50 duration-300 pointer-events-auto origin-bottom"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onEdit}
        title="Edit Content"
      >
        <Edit2 size={16} />
      </Button>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Change Color"
          >
            <Palette size={16} style={{ color: annotation.color }} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-4" side="top">
          <div className="grid grid-cols-6 gap-2">
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                className={cn(
                  "w-6 h-6 rounded-full border border-gray-200 hover:scale-110 transition-transform",
                  annotation.color === c &&
                    "ring-2 ring-primary ring-offset-2 scale-110"
                )}
                style={{ backgroundColor: c }}
                onClick={() => onUpdate({ color: c })}
                title={c}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
        onClick={onDelete}
        title="Delete"
      >
        <Trash2 size={16} />
      </Button>
    </div>
  );
};

export default AnnotationToolbar;
