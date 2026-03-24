import React from "react";
import { Annotation } from "@/types";
import { PropertyPanelProps } from "./types";
import { Label } from "@/components/ui/label";
import { Palette } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FONT_FAMILY_MAP } from "@/constants";
import { getSystemFontFamilies } from "@/lib/system-fonts";
import { resolveFontStackForDisplay } from "@/lib/fonts";
import { ColorPropertyInput } from "./ColorPropertyInput";

export const FreetextProperties: React.FC<PropertyPanelProps<Annotation>> = ({
  data,
  onChange,
  onTriggerHistorySave,
}) => {
  const { t } = useLanguage();

  const [systemFamilies, setSystemFamilies] = React.useState<string[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    void getSystemFontFamilies().then((families) => {
      if (cancelled) return;
      setSystemFamilies(families);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const displaySize = Math.round((data.size || 12) as number);
  const lineHeightMultiplier =
    typeof data.lineHeight === "number" &&
    Number.isFinite(data.lineHeight) &&
    data.lineHeight > 0
      ? data.lineHeight
      : 1;
  const displayLineHeight = Math.round(lineHeightMultiplier * 100);

  const availableFontKeys = [
    ...Object.keys(FONT_FAMILY_MAP),
    ...systemFamilies,
  ];
  const currentFontValue = data.fontFamily || "Helvetica";
  const isCustomFontValue =
    !!data.fontFamily && !availableFontKeys.includes(data.fontFamily);

  const isTransparent = !data.backgroundColor;
  const isFlatten = Boolean(data.flatten);
  const borderWidth =
    typeof data.borderWidth === "number" && Number.isFinite(data.borderWidth)
      ? Math.max(0, data.borderWidth)
      : 0;

  return (
    <div>
      <h4 className="text-muted-foreground mb-3 flex items-center text-xs font-semibold tracking-wider uppercase">
        <Palette size={12} className="mr-1.5" />
        {t("properties.appearance")}
      </h4>
      <div className="space-y-4">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label>{t("properties.flatten")}</Label>
            <div className="flex items-center gap-2">
              <Switch
                id="freetextFlatten"
                checked={isFlatten}
                onMouseDown={onTriggerHistorySave}
                onCheckedChange={(checked) => onChange({ flatten: checked })}
              />
            </div>
          </div>
        </div>

        {/* Color */}
        <div className="space-y-2">
          <Label>{t("properties.color")}</Label>
          <ColorPropertyInput
            title={t("properties.color")}
            paletteType="foreground"
            color={data.color || "#000000"}
            opacity={data.opacity ?? 1}
            showOpacity
            onInteractionStart={onTriggerHistorySave}
            onColorChange={(color) => onChange({ color })}
            onOpacityChange={(opacity) => onChange({ opacity })}
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label>{t("properties.background")}</Label>
            <div className="flex items-center gap-2">
              <Switch
                id="freetextTransparent"
                checked={isTransparent}
                onMouseDown={onTriggerHistorySave}
                onCheckedChange={(checked) =>
                  onChange({ backgroundColor: checked ? undefined : "#ffffff" })
                }
              />
              <Label
                htmlFor="freetextTransparent"
                className="text-xs font-normal"
              >
                {t("properties.transparent")}
              </Label>
            </div>
          </div>
          <ColorPropertyInput
            title={t("properties.background")}
            paletteType="background"
            disabled={isTransparent}
            color={data.backgroundColor || "#ffffff"}
            onInteractionStart={onTriggerHistorySave}
            onColorChange={(backgroundColor) => onChange({ backgroundColor })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>{t("properties.border_color")}</Label>
            <ColorPropertyInput
              title={t("properties.border_color")}
              paletteType="foreground"
              color={data.borderColor || "#000000"}
              onInteractionStart={onTriggerHistorySave}
              onColorChange={(borderColor) => onChange({ borderColor })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("properties.border_width")}</Label>
            <NumberInput
              minValue={0}
              maxValue={10}
              value={borderWidth}
              onFocus={onTriggerHistorySave}
              onChange={(val) => onChange({ borderWidth: val })}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>{t("properties.font_family")}</Label>
          <Select
            value={currentFontValue}
            onValueChange={(val) => {
              onTriggerHistorySave();
              onChange({ fontFamily: val });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(FONT_FAMILY_MAP).map(([name, font]) => (
                <SelectItem key={name} value={name}>
                  <span style={{ fontFamily: font }}>{name}</span>
                </SelectItem>
              ))}
              {systemFamilies
                .filter(
                  (name) =>
                    !Object.prototype.hasOwnProperty.call(
                      FONT_FAMILY_MAP,
                      name,
                    ),
                )
                .map((name) => (
                  <SelectItem key={name} value={name}>
                    <span
                      style={{ fontFamily: resolveFontStackForDisplay(name) }}
                    >
                      {name}
                    </span>
                  </SelectItem>
                ))}
              {isCustomFontValue && (
                <SelectItem value={data.fontFamily as string}>
                  {data.fontFamily as string}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Font Size */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t("properties.font_size") || "Font Size"}</Label>
            <span className="text-muted-foreground text-xs">
              {displaySize}pt
            </span>
          </div>
          <Slider
            value={[displaySize]}
            min={8}
            max={72}
            step={1}
            onValueCommit={onTriggerHistorySave}
            onValueChange={(vals) => onChange({ size: vals[0] })}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t("properties.line_height") || "Line Height"}</Label>
            <span className="text-muted-foreground text-xs">
              {displayLineHeight}%
            </span>
          </div>
          <Slider
            value={[lineHeightMultiplier]}
            min={0.8}
            max={2}
            step={0.05}
            onValueCommit={onTriggerHistorySave}
            onValueChange={(vals) => onChange({ lineHeight: vals[0] })}
          />
        </div>
      </div>
    </div>
  );
};
