import React from "react";
import { Annotation } from "@/types";
import { PropertyPanelProps } from "./types";
import { Label } from "@/components/ui/label";
import { Palette } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Slider } from "@/components/ui/slider";

export const FreetextProperties: React.FC<PropertyPanelProps<Annotation>> = ({
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
            value={data.color || "#000000"}
            onMouseDown={onTriggerHistorySave}
            onChange={(e) => onChange({ color: e.target.value })}
            className="border-input bg-background h-8 w-full cursor-pointer rounded border"
          />
        </div>

        {/* Font Size */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t("properties.font_size") || "Font Size"}</Label>
            <span className="text-muted-foreground text-xs">
              {data.size || 12}px
            </span>
          </div>
          <Slider
            value={[data.size || 12]}
            min={8}
            max={72}
            step={1}
            onValueCommit={onTriggerHistorySave}
            onValueChange={(vals) => onChange({ size: vals[0] })}
          />
        </div>
      </div>
    </div>
  );
};
