import React from "react";
import { Edit2, Trash2, Palette } from "lucide-react";
import { Annotation } from "../../types";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "../../utils/cn";
import { PEN_COLORS } from "../../constants";

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
}) => {
  // Only render for comments currently
  if (annotation.type !== "comment") return null;

  return (
    <div
      className="bg-background border-border animate-in fade-in zoom-in-50 pointer-events-auto mb-2 flex origin-bottom items-center gap-1 rounded-md border p-1 shadow-md duration-300"
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

      <Popover modal>
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
                  "h-6 w-6 rounded-full border border-gray-200 transition-transform hover:scale-110",
                  annotation.color === c &&
                    "ring-primary scale-110 ring-2 ring-offset-2",
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
        className="hover:bg-destructive/10 hover:text-destructive h-8 w-8"
        onClick={onDelete}
        title="Delete"
      >
        <Trash2 size={16} />
      </Button>
    </div>
  );
};

export default AnnotationToolbar;
