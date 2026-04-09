import React from "react";
import { Annotation, FormField } from "@/types";
import { PropertyPanelProps } from "./types";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Slider } from "@/components/ui/slider";
import { Type } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { registry } from "@/components/workspace/controls/registry/ControlRegistry";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  normalizeRotationDeg,
  normalizeRightAngleRotationDeg,
  rotateOuterRectKeepingCenter,
} from "@/lib/controlRotation";

export const GeometryProperties: React.FC<
  PropertyPanelProps<FormField | Annotation>
> = ({ data, onChange, onTriggerHistorySave }) => {
  const { t } = useLanguage();
  if (!data.rect) return null;
  const rect = data.rect;
  const controlConfig = registry.get(data.type);
  const supportsSizeEditing =
    typeof controlConfig?.supportsGeometrySizeEdit === "function"
      ? controlConfig.supportsGeometrySizeEdit(data)
      : controlConfig?.supportsGeometrySizeEdit !== undefined
        ? controlConfig.supportsGeometrySizeEdit
        : true;
  const isFormField = "name" in data && "style" in data;
  const isFreeText = data.type === "freetext";
  const isShape = data.type === "shape";
  const isStamp = data.type === "stamp";
  const rotationDeg =
    isFormField &&
    typeof data.rotationDeg === "number" &&
    Number.isFinite(data.rotationDeg)
      ? normalizeRightAngleRotationDeg(data.rotationDeg)
      : 0;
  const freeTextRotationDeg =
    isFreeText &&
    typeof data.rotationDeg === "number" &&
    Number.isFinite(data.rotationDeg)
      ? data.rotationDeg
      : 0;
  const shapeRotationDeg =
    isShape &&
    typeof data.rotationDeg === "number" &&
    Number.isFinite(data.rotationDeg)
      ? normalizeRotationDeg(data.rotationDeg)
      : 0;
  const stampRotationDeg =
    isStamp &&
    typeof data.rotationDeg === "number" &&
    Number.isFinite(data.rotationDeg)
      ? normalizeRotationDeg(data.rotationDeg)
      : 0;

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
            value={Math.round(rect.x)}
            formatOptions={{ maximumFractionDigits: 0 }}
            onFocus={onTriggerHistorySave}
            onChange={(val) => onChange({ rect: { ...rect, x: val } })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("properties.y")}</Label>
          <NumberInput
            aria-label={t("properties.y")}
            value={Math.round(rect.y)}
            formatOptions={{ maximumFractionDigits: 0 }}
            onFocus={onTriggerHistorySave}
            onChange={(val) => onChange({ rect: { ...rect, y: val } })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("properties.width")}</Label>
          <NumberInput
            aria-label={t("properties.width")}
            value={Math.round(rect.width)}
            formatOptions={{ maximumFractionDigits: 0 }}
            isReadOnly={!supportsSizeEditing}
            onFocus={supportsSizeEditing ? onTriggerHistorySave : undefined}
            onChange={
              supportsSizeEditing
                ? (val) => onChange({ rect: { ...rect, width: val } })
                : undefined
            }
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("properties.height")}</Label>
          <NumberInput
            aria-label={t("properties.height")}
            value={Math.round(rect.height)}
            formatOptions={{ maximumFractionDigits: 0 }}
            isReadOnly={!supportsSizeEditing}
            onFocus={supportsSizeEditing ? onTriggerHistorySave : undefined}
            onChange={
              supportsSizeEditing
                ? (val) => onChange({ rect: { ...rect, height: val } })
                : undefined
            }
          />
        </div>
      </div>
      {isFormField && (
        <div className="mt-4 space-y-1">
          <Label className="text-xs">{t("properties.rotation")}</Label>
          <Select
            value={String(rotationDeg)}
            onValueChange={(value) => {
              const nextRotation = normalizeRightAngleRotationDeg(
                Number.parseInt(value, 10),
              );
              onTriggerHistorySave?.();
              onChange({
                rect: rotateOuterRectKeepingCenter(
                  rect,
                  rotationDeg,
                  nextRotation,
                ),
                rotationDeg: nextRotation,
              });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 90, 180, 270].map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value}°
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {(isFreeText || isShape || isStamp) && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">{t("properties.rotation")}</Label>
            <span className="text-muted-foreground text-xs">
              {Math.round(
                isShape
                  ? shapeRotationDeg
                  : isStamp
                    ? stampRotationDeg
                    : freeTextRotationDeg,
              )}
              °
            </span>
          </div>
          <Slider
            value={[
              isShape
                ? shapeRotationDeg
                : isStamp
                  ? stampRotationDeg
                  : freeTextRotationDeg,
            ]}
            min={-180}
            max={180}
            step={1}
            onValueCommit={onTriggerHistorySave}
            onValueChange={(vals) => onChange({ rotationDeg: vals[0] })}
          />
        </div>
      )}
    </div>
  );
};
