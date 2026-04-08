import React from "react";

import { useLanguage } from "../language-provider";
import { Label } from "../ui/label";
import {
  DEFAULT_SHAPE_DASH_DENSITY,
  MAX_SHAPE_DASH_DENSITY,
  MIN_SHAPE_DASH_DENSITY,
  normalizeShapeDashDensity,
  type ShapeBorderStyle,
} from "@/lib/shapeGeometry";
import { Slider } from "../ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

interface ShapeBorderStyleSectionProps {
  value: ShapeBorderStyle;
  dashDensity?: number;
  onChange: (value: ShapeBorderStyle) => void;
  onDashDensityChange?: (value: number) => void;
  onInteractionStart?: () => void;
}

export const ShapeBorderStyleSection: React.FC<
  ShapeBorderStyleSectionProps
> = ({
  value,
  dashDensity = DEFAULT_SHAPE_DASH_DENSITY,
  onChange,
  onDashDensityChange,
  onInteractionStart,
}) => {
  const { t } = useLanguage();
  const normalizedDashDensity = normalizeShapeDashDensity(dashDensity);

  return (
    <div className="space-y-2">
      <Label>{t("properties.border_style") || "Border Style"}</Label>
      <Select
        value={value}
        onValueChange={(nextValue) => {
          onInteractionStart?.();
          onChange(nextValue as ShapeBorderStyle);
        }}
      >
        <SelectTrigger
          className="w-full"
          onPointerDown={() => onInteractionStart?.()}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="solid">
            {t("properties.solid") || "Solid"}
          </SelectItem>
          <SelectItem value="dashed">
            {t("properties.dashed") || "Dashed"}
          </SelectItem>
        </SelectContent>
      </Select>
      {value === "dashed" && onDashDensityChange && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <Label>{t("properties.dash_density") || "Dash Density"}</Label>
            <span className="text-muted-foreground text-xs">
              {Math.round(normalizedDashDensity * 100)}%
            </span>
          </div>
          <Slider
            value={[normalizedDashDensity]}
            min={MIN_SHAPE_DASH_DENSITY}
            max={MAX_SHAPE_DASH_DENSITY}
            step={0.1}
            onValueCommit={() => onInteractionStart?.()}
            onValueChange={(values) =>
              onDashDensityChange(normalizeShapeDashDensity(values[0]))
            }
          />
        </div>
      )}
    </div>
  );
};
