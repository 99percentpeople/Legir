import React from "react";
import { Annotation } from "@/types";
import { PropertyPanelProps } from "./types";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Palette, PenTool } from "lucide-react";
import { useLanguage } from "@/components/language-provider";

export const InkProperties: React.FC<PropertyPanelProps<Annotation>> = ({
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
            onChange={(e) =>
              onChange({
                color: e.target.value,
                appearanceStreamContent: undefined,
              })
            }
            className="border-input bg-background h-8 w-full cursor-pointer rounded border"
          />
        </div>

        {/* Thickness */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2">
              <PenTool size={14} />
              {t("properties.thickness") || "Thickness"}
            </Label>
            <span className="text-muted-foreground text-xs">
              {data.thickness || 1}px
            </span>
          </div>
          <Slider
            value={[data.thickness || 1]}
            min={1}
            max={20}
            step={1}
            onValueChange={(vals) => {
              onTriggerHistorySave();
              onChange({
                thickness: vals[0],
                appearanceStreamContent: undefined,
              });
            }}
          />
        </div>
      </div>
    </div>
  );
};
