import React from "react";
import { cn } from "../../lib/utils";
import { Slider } from "../ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { ChevronDown } from "lucide-react";
import { PenStyle } from "../../types";

const PEN_COLORS = [
  // Row 1
  "#000000", "#545454", "#737373", "#a6a6a6", "#d9d9d9", "#ffffff",
  // Row 2
  "#991b1b", "#dc2626", "#ea580c", "#f59e0b", "#facc15", "#ffff00",
  // Row 3
  "#84cc16", "#22c55e", "#10b981", "#06b6d4", "#3b82f6", "#6366f1",
  // Row 4
  "#8b5cf6", "#a855f7", "#d946ef", "#be185d", "#9f1239", "#881337",
  // Row 5
  "#ffaff3", "#ffcea0", "#fff9c4", "#bbf7d0", "#bfdbfe", "#e9d5ff"
];

interface InkPropertiesPopoverProps {
  penStyle: PenStyle;
  onPenStyleChange: (style: Partial<PenStyle>) => void;
  isActive?: boolean;
}

export const InkPropertiesPopover: React.FC<InkPropertiesPopoverProps> = ({
  penStyle,
  onPenStyleChange,
  isActive = false
}) => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className={cn(
            "h-9 w-5 p-0 rounded-l-none hover:bg-muted",
            isActive && "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground"
          )}
          title="Ink Properties"
        >
          <ChevronDown size={12} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-4" side="bottom" align="center">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">颜色</label>
            <div className="grid grid-cols-6 gap-2">
              {PEN_COLORS.map((c) => (
                <button
                  key={c}
                  className={cn(
                    "w-6 h-6 rounded-full border border-gray-200 hover:scale-110 transition-transform",
                    penStyle.color === c && "ring-2 ring-primary ring-offset-2 scale-110"
                  )}
                  style={{ backgroundColor: c }}
                  onClick={() => onPenStyleChange({ color: c })}
                  title={c}
                />
              ))}
            </div>
          </div>

          <div className="h-16 flex items-center justify-center bg-muted/30 rounded-md border border-border overflow-hidden">
             <svg width="100%" height="100%" viewBox="0 0 200 60" className="pointer-events-none">
                <path
                  d="M 20 30 Q 60 10, 100 30 T 180 30"
                  fill="none"
                  stroke={penStyle.color}
                  strokeWidth={penStyle.thickness}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
             </svg>
          </div>

          <div>
            <div className="flex justify-between mb-2 items-center">
              <label className="text-sm font-medium">粗细</label>
              <span className="text-xs text-muted-foreground">{penStyle.thickness}px</span>
            </div>
            <Slider
              defaultValue={[penStyle.thickness]}
              value={[penStyle.thickness]}
              max={20}
              min={1}
              step={1}
              onValueChange={(val) => onPenStyleChange({ thickness: val[0] })}
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>细</span>
              <span>粗</span>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
