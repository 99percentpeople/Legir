import React from "react";
import { Annotation } from "@/types";
import { PropertyPanelProps } from "./types";
import { Label } from "@/components/ui/label";
import { Palette } from "lucide-react";
import { useLanguage } from "@/components/language-provider";

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
          <input
            type="color"
            value={data.color || "#ffff00"}
            onMouseDown={onTriggerHistorySave}
            onChange={(e) => onChange({ color: e.target.value })}
            className="border-input bg-background h-8 w-full cursor-pointer rounded border"
          />
        </div>
      </div>
    </div>
  );
};
