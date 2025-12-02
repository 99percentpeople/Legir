import React from 'react';
import { Edit2, Trash2, Palette } from 'lucide-react';
import { Annotation } from '../../types';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { cn } from '../../lib/utils';

const PEN_COLORS = [
  // Row 1
  "#000000", "#545454", "#737373", "#a6a6a6", "#d9d9d9", "#ffffff",
  // Row 2
  "#991b1b", "#ef4444", "#ea580c", "#f59e0b", "#facc15", "#ffff00",
  // Row 3
  "#84cc16", "#22c55e", "#10b981", "#06b6d4", "#3b82f6", "#6366f1",
  // Row 4
  "#8b5cf6", "#a855f7", "#d946ef", "#be185d", "#9f1239", "#881337",
  // Row 5
  "#ffaff3", "#ffcea0", "#fff9c4", "#bbf7d0", "#bfdbfe", "#e9d5ff"
];

interface AnnotationToolbarProps {
  annotation: Annotation;
  onUpdate: (updates: Partial<Annotation>) => void;
  onDelete: () => void;
  onEdit: () => void;
  scale: number;
}

export const AnnotationToolbar: React.FC<AnnotationToolbarProps> = ({
  annotation,
  onUpdate,
  onDelete,
  onEdit,
  scale
}) => {
  // Only render for notes currently
  if (annotation.type !== 'note') return null;

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
                    annotation.color === c && "ring-2 ring-primary ring-offset-2 scale-110"
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
