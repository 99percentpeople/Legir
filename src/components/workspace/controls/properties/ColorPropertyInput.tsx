import React from "react";
import { Palette } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ColorPickerPopover } from "@/components/toolbar/ColorPickerPopover";
import type { ColorPaletteType } from "@/lib/colorPalette";

interface ColorPropertyInputProps {
  color: string;
  opacity?: number;
  title: string;
  paletteType?: ColorPaletteType;
  disabled?: boolean;
  showOpacity?: boolean;
  onColorChange: (color: string) => void;
  onOpacityChange?: (opacity: number) => void;
  onInteractionStart?: () => void;
}

export const ColorPropertyInput: React.FC<ColorPropertyInputProps> = ({
  color,
  opacity,
  title,
  paletteType = "foreground",
  disabled = false,
  showOpacity = false,
  onColorChange,
  onOpacityChange,
  onInteractionStart,
}) => {
  const shouldShowOpacity =
    showOpacity &&
    typeof opacity === "number" &&
    Number.isFinite(opacity) &&
    !!onOpacityChange;

  return (
    <ColorPickerPopover
      color={color}
      opacity={opacity}
      paletteType={paletteType}
      onColorChange={onColorChange}
      onOpacityChange={onOpacityChange}
      onInteractionStart={onInteractionStart}
      showThickness={false}
      showOpacity={shouldShowOpacity}
      align="start"
      title={title}
    >
      <Button
        type="button"
        variant="outline"
        className="w-full justify-between px-3"
        disabled={disabled}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="h-4 w-4 rounded-full border border-black/10 shadow-sm"
            style={{ backgroundColor: color }}
          />
          <span className="truncate font-mono text-xs uppercase">{color}</span>
        </span>
        {shouldShowOpacity ? (
          <span className="text-muted-foreground text-xs">
            {Math.round((opacity ?? 1) * 100)}%
          </span>
        ) : (
          <Palette className="text-muted-foreground size-4" />
        )}
      </Button>
    </ColorPickerPopover>
  );
};
