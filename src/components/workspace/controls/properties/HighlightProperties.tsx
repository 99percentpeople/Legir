import React from "react";
import { Annotation } from "@/types";
import { PropertyPanelProps } from "./types";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Palette } from "lucide-react";
import { useLanguage } from "@/components/language-provider";

export const HighlightProperties: React.FC<PropertyPanelProps<Annotation>> = ({
  data,
  onChange,
  onTriggerHistorySave,
}) => {
  const { t } = useLanguage();

  return (
    <div>
      <h4 className="text-muted-foreground mb-3 flex items-center text-xs font-semibold tracking-wider uppercase">
        <Palette size={12} className="mr-1.5" />
        {t("properties.appearance")}
      </h4>
      <div className="space-y-4">
        {/* Color */}
        <div className="space-y-2">
          <Label>{t("properties.color")}</Label>
          <input
            type="color"
            value={data.color || "#ffff00"}
            onMouseDown={onTriggerHistorySave}
            onChange={(e) => onChange({ color: e.target.value })}
            className="border-input bg-background h-8 w-full cursor-pointer rounded border"
          />
        </div>

        {/* Opacity */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t("properties.opacity")}</Label>
            <span className="text-muted-foreground text-xs">
              {Math.round((data.opacity || 1) * 100)}%
            </span>
          </div>
          <Slider
            value={[data.opacity || 1]}
            min={0.1}
            max={1}
            step={0.1}
            onValueChange={(vals) => {
              onTriggerHistorySave();
              onChange({ opacity: vals[0] });
            }}
          />
        </div>
      </div>
    </div>
  );
};
