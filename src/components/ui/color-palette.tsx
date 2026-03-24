import React from "react";
import { ChevronDown, ChevronUp, Palette } from "lucide-react";

import {
  getColorPaletteRows,
  normalizePaletteColor,
  COLOR_PALETTE_RECENT_ROW_SIZE,
  type ColorPaletteType,
  recordPaletteColorSelection,
  subscribeToColorPaletteState,
} from "@/lib/colorPalette";
import { cn } from "@/utils/cn";

import { useLanguage } from "../language-provider";
import { Button } from "./button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible";
import { Slider } from "./slider";

interface ColorPaletteProps {
  color: string;
  opacity?: number;
  paletteType?: ColorPaletteType;
  onColorChange: (color: string) => void;
  onOpacityChange?: (opacity: number) => void;
  onInteractionStart?: () => void;
  showOpacity?: boolean;
  disabled?: boolean;
  className?: string;
}

const swatchButtonClassName =
  "relative h-8 w-8 rounded-full border border-black/10 shadow-sm transition-transform hover:scale-105 disabled:pointer-events-none disabled:opacity-50";

export function ColorPaletteControl({
  color,
  opacity,
  paletteType = "foreground",
  onColorChange,
  onOpacityChange,
  onInteractionStart,
  showOpacity = false,
  disabled = false,
  className,
}: ColorPaletteProps) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = React.useState(false);
  const [rows, setRows] = React.useState(() =>
    getColorPaletteRows(color, paletteType),
  );
  const customColorInputRef = React.useRef<HTMLInputElement>(null);
  const selectedColor = normalizePaletteColor(color) ?? color.toLowerCase();

  React.useEffect(() => {
    setRows(getColorPaletteRows(color, paletteType));
  }, [color, paletteType]);

  React.useEffect(
    () =>
      subscribeToColorPaletteState(() => {
        setRows(getColorPaletteRows(color, paletteType));
      }),
    [color, paletteType],
  );

  const selectColor = (nextColor: string) => {
    onInteractionStart?.();
    recordPaletteColorSelection(nextColor);
    onColorChange(nextColor);
    setRows(getColorPaletteRows(nextColor, paletteType));
  };

  const renderSwatch = (swatchColor: string, swatchTitle: string) => (
    <button
      key={swatchColor}
      type="button"
      disabled={disabled}
      className={cn(
        swatchButtonClassName,
        selectedColor === swatchColor && "ring-primary ring-2 ring-offset-2",
      )}
      style={{ backgroundColor: swatchColor }}
      onClick={() => selectColor(swatchColor)}
      title={swatchTitle}
    />
  );

  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-2">
        <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          {t("properties.common_colors") || "Common Colors"}
        </div>
        <div className="grid grid-cols-6 gap-2">
          {rows.commonColors.map((swatchColor) =>
            renderSwatch(swatchColor, swatchColor),
          )}
        </div>
      </div>

      {rows.recentColors.length > 0 && (
        <div className="space-y-2">
          <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
            {t("properties.recent_colors") || "Recent Colors"}
          </div>
          <div className="grid grid-cols-6 gap-2">
            {rows.recentColors.map((swatchColor) =>
              renderSwatch(swatchColor, swatchColor),
            )}
            {Array.from({
              length: Math.max(
                0,
                COLOR_PALETTE_RECENT_ROW_SIZE - rows.recentColors.length,
              ),
            }).map((_, index) => (
              <div
                key={`recent-placeholder-${index}`}
                className="bg-muted/20 border-input/60 h-8 w-8 rounded-full border border-dashed"
                aria-hidden="true"
              />
            ))}
          </div>
        </div>
      )}

      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-7 w-full justify-between px-2"
          >
            <span>{expanded ? t("common.collapse") : t("common.expand")}</span>
            {expanded ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-1">
          <div className="grid grid-cols-6 gap-2">
            {rows.expandedColors.map((swatchColor) =>
              renderSwatch(swatchColor, swatchColor),
            )}
            <button
              type="button"
              disabled={disabled}
              className={cn(
                "bg-muted/40 border-input relative flex h-8 w-8 items-center justify-center rounded-full border border-dashed transition-transform hover:scale-105",
                disabled && "pointer-events-none opacity-50",
              )}
              onClick={() => customColorInputRef.current?.click()}
              title={t("properties.custom_color") || "Custom Color"}
            >
              <Palette className="text-muted-foreground size-3.5" />
              <span
                className="absolute right-0 bottom-0 h-3.5 w-3.5 rounded-full border border-white shadow-sm"
                style={{ backgroundColor: rows.customColor }}
              />
            </button>
          </div>
          <input
            ref={customColorInputRef}
            type="color"
            className="sr-only"
            value={rows.customColor}
            onChange={(event) => selectColor(event.currentTarget.value)}
          />
        </CollapsibleContent>
      </Collapsible>

      {showOpacity && opacity !== undefined && onOpacityChange && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">{t("properties.opacity")}</div>
            <div className="text-muted-foreground text-xs">
              {Math.round(opacity * 100)}%
            </div>
          </div>
          <Slider
            value={[opacity]}
            min={0.05}
            max={1}
            step={0.05}
            onValueChange={(values) => {
              onInteractionStart?.();
              onOpacityChange(values[0]);
            }}
          />
        </div>
      )}
    </div>
  );
}
