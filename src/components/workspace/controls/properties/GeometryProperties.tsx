import React from "react";
import { Annotation, FormField } from "@/types";
import { PropertyPanelProps } from "./types";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Type } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { registry } from "@/components/workspace/controls/registry/ControlRegistry";

export const GeometryProperties: React.FC<
  PropertyPanelProps<FormField | Annotation>
> = ({ data, onChange, onTriggerHistorySave }) => {
  const { t } = useLanguage();
  const controlConfig = registry.get(data.type);
  const supportsSizeEditing =
    typeof controlConfig?.supportsGeometrySizeEdit === "function"
      ? controlConfig.supportsGeometrySizeEdit(data)
      : controlConfig?.supportsGeometrySizeEdit !== undefined
        ? controlConfig.supportsGeometrySizeEdit
        : true;

  return (
    <div>
      <h4 className="text-muted-foreground mb-3 flex items-center text-xs font-semibold tracking-wider uppercase">
        <Type size={12} className="mr-1.5" />
        {t("properties.geometry")}
      </h4>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label className="text-xs">{t("properties.x")}</Label>
          <NumberInput
            aria-label={t("properties.x")}
            value={Math.round(data.rect.x)}
            formatOptions={{ maximumFractionDigits: 0 }}
            onFocus={onTriggerHistorySave}
            onChange={(val) => onChange({ rect: { ...data.rect, x: val } })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("properties.y")}</Label>
          <NumberInput
            aria-label={t("properties.y")}
            value={Math.round(data.rect.y)}
            formatOptions={{ maximumFractionDigits: 0 }}
            onFocus={onTriggerHistorySave}
            onChange={(val) => onChange({ rect: { ...data.rect, y: val } })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("properties.width")}</Label>
          <NumberInput
            aria-label={t("properties.width")}
            value={Math.round(data.rect.width)}
            formatOptions={{ maximumFractionDigits: 0 }}
            isReadOnly={!supportsSizeEditing}
            onFocus={supportsSizeEditing ? onTriggerHistorySave : undefined}
            onChange={
              supportsSizeEditing
                ? (val) => onChange({ rect: { ...data.rect, width: val } })
                : undefined
            }
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("properties.height")}</Label>
          <NumberInput
            aria-label={t("properties.height")}
            value={Math.round(data.rect.height)}
            formatOptions={{ maximumFractionDigits: 0 }}
            isReadOnly={!supportsSizeEditing}
            onFocus={supportsSizeEditing ? onTriggerHistorySave : undefined}
            onChange={
              supportsSizeEditing
                ? (val) => onChange({ rect: { ...data.rect, height: val } })
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
};
