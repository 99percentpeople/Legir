import React from "react";
import { Annotation } from "@/types";
import { PropertyPanelProps } from "./types";
import { Label } from "@/components/ui/label";
import { Palette } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
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
  const displayOpacity = Math.round(((data.opacity ?? 1) as number) * 100);

  const availableFontKeys = [
    ...Object.keys(FONT_FAMILY_MAP),
    ...systemFamilies,
  ];
  const currentFontValue = data.fontFamily || "Helvetica";
  const isCustomFontValue =
    !!data.fontFamily && !availableFontKeys.includes(data.fontFamily);

  const isTransparent = !data.backgroundColor;

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
          <input
            type="color"
            disabled={isTransparent}
            value={data.backgroundColor || "#ffffff"}
            onMouseDown={onTriggerHistorySave}
            onChange={(e) => onChange({ backgroundColor: e.target.value })}
            className="border-input bg-background h-8 w-full cursor-pointer rounded border disabled:opacity-50"
          />
        </div>

        {/* Opacity */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t("properties.opacity")}</Label>
            <span className="text-muted-foreground text-xs">
              {displayOpacity}%
            </span>
          </div>
          <Slider
            value={[data.opacity ?? 1]}
            min={0.05}
            max={1}
            step={0.05}
            onValueCommit={onTriggerHistorySave}
            onValueChange={(vals) => onChange({ opacity: vals[0] })}
          />
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
      </div>
    </div>
  );
};
