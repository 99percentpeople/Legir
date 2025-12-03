import React from "react";
import { cn } from "../../lib/utils";
import { Slider } from "../ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { ChevronDown } from "lucide-react";
import { useLanguage } from "../language-provider";

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
  "#00aacc",
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
  "#9bd6a9",
  "#80d6ff",
  "#bcb3ff",
];

interface ColorPickerPopoverProps {
  color: string;
  thickness?: number;
  onColorChange: (color: string) => void;
  onThicknessChange?: (thickness: number) => void;
  isActive?: boolean;
  showThickness?: boolean;
  title?: string;
}

export const ColorPickerPopover: React.FC<ColorPickerPopoverProps> = ({
  color,
  thickness,
  onColorChange,
  onThicknessChange,
  isActive = false,
  showThickness = true,
  title = "Properties",
}) => {
  const { t } = useLanguage();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-9 w-5 p-0 rounded-l-none hover:bg-muted",
            isActive &&
              "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground"
          )}
          title={title}
        >
          <ChevronDown size={12} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-4" side="bottom" align="center">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">
              {t("properties.color")}
            </label>
            <div className="grid grid-cols-6 gap-2">
              {PEN_COLORS.map((c) => (
                <button
                  key={c}
                  className={cn(
                    "w-6 h-6 rounded-full border border-gray-200 hover:scale-110 transition-transform",
                    color === c && "ring-2 ring-primary ring-offset-2 scale-110"
                  )}
                  style={{ backgroundColor: c }}
                  onClick={() => onColorChange(c)}
                  title={c}
                />
              ))}
            </div>
          </div>

          {showThickness && thickness !== undefined && onThicknessChange && (
            <>
              <div className="h-16 flex items-center justify-center bg-muted/30 rounded-md border border-border overflow-hidden">
                <svg
                  width="100%"
                  height="100%"
                  viewBox="0 0 200 60"
                  className="pointer-events-none"
                >
                  <path
                    d="M 20 30 Q 60 10, 100 30 T 180 30"
                    fill="none"
                    stroke={color}
                    strokeWidth={thickness}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              <div>
                <div className="flex justify-between mb-2 items-center">
                  <label className="text-sm font-medium">
                    {t("properties.thickness")}
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {thickness}px
                  </span>
                </div>
                <Slider
                  defaultValue={[thickness]}
                  value={[thickness]}
                  max={20}
                  min={1}
                  step={1}
                  onValueChange={(val) => onThicknessChange(val[0])}
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>Thin</span>
                  <span>Thick</span>
                </div>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
