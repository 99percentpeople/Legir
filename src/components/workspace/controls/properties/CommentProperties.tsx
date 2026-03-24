import React from "react";
import { Annotation } from "@/types";
import { PropertyPanelProps } from "./types";
import { Label } from "@/components/ui/label";
import { Palette } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { ColorPropertyInput } from "./ColorPropertyInput";

export const CommentProperties: React.FC<PropertyPanelProps<Annotation>> = ({
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
          <ColorPropertyInput
            title={t("properties.color")}
            paletteType="foreground"
            color={data.color || "#ffff00"}
            opacity={data.opacity ?? 1}
            showOpacity
            onInteractionStart={onTriggerHistorySave}
            onColorChange={(color) => onChange({ color })}
            onOpacityChange={(opacity) => onChange({ opacity })}
          />
        </div>
      </div>
    </div>
  );
};
