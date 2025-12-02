

import React from 'react';
import { Annotation } from '../../types';
import { Button } from '../ui/button';
import { AlignLeft, AlignCenter, AlignRight, Minus, Plus, Trash2 } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
import { Separator } from '../ui/separator';
import { cn } from '../../lib/utils';

interface AnnotationToolbarProps {
  annotation: Annotation;
  onUpdate: (updates: Partial<Annotation>) => void;
  onDelete: () => void;
  scale: number;
}

const AnnotationToolbar: React.FC<AnnotationToolbarProps> = ({
  annotation,
  onUpdate,
  onDelete,
  scale
}) => {
  // Only render for notes currently, but extensible
  if (annotation.type !== 'note' || !annotation.rect) return null;

  const currentSize = annotation.size || 12;

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdate({ color: e.target.value });
  };

  return (
    <div 
      className="absolute flex items-center gap-1 p-1 bg-white dark:bg-zinc-800 rounded-md shadow-xl border border-border z-50 transition-none"
      style={{
        left: annotation.rect.x * scale,
        top: (annotation.rect.y * scale) - 46, // Position above the note
        transition: 'none' // Explicitly disable transition for smooth dragging
      }}
      onMouseDown={(e) => e.stopPropagation()} // Prevent deselecting
    >
      {/* Font Size */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onUpdate({ size: Math.max(8, currentSize - 2) })}
          title="Decrease Font Size"
        >
          <Minus size={14} />
        </Button>
        <span className="text-xs w-6 text-center tabular-nums">{currentSize}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onUpdate({ size: Math.min(72, currentSize + 2) })}
          title="Increase Font Size"
        >
          <Plus size={14} />
        </Button>
      </div>

      <Separator orientation="vertical" className="h-4 mx-1" />

      {/* Alignment */}
      <ToggleGroup 
        type="single" 
        value={annotation.alignment || 'left'}
        onValueChange={(val) => val && onUpdate({ alignment: val as 'left' | 'center' | 'right' })}
        className="gap-0"
      >
        <ToggleGroupItem value="left" size="sm" className="h-7 w-7 p-0">
          <AlignLeft size={14} />
        </ToggleGroupItem>
        <ToggleGroupItem value="center" size="sm" className="h-7 w-7 p-0">
          <AlignCenter size={14} />
        </ToggleGroupItem>
        <ToggleGroupItem value="right" size="sm" className="h-7 w-7 p-0">
          <AlignRight size={14} />
        </ToggleGroupItem>
      </ToggleGroup>

      <Separator orientation="vertical" className="h-4 mx-1" />

      {/* Color Picker */}
      <div className="flex items-center justify-center w-7 h-7 relative">
         <input
            type="color"
            value={annotation.color || '#000000'}
            onChange={handleColorChange}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            title="Text Color"
          />
          <div 
            className="w-4 h-4 rounded-full border border-gray-300 shadow-sm" 
            style={{ backgroundColor: annotation.color || '#000000' }}
          />
      </div>

      <Separator orientation="vertical" className="h-4 mx-1" />

      {/* Delete */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
        onClick={onDelete}
        title="Delete Note"
      >
        <Trash2 size={14} />
      </Button>
    </div>
  );
};

export default AnnotationToolbar;