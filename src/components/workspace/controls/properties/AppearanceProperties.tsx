import React from "react";
import { FormField, FieldType } from "@/types";
import { PropertyPanelProps } from "./types";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Palette, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { FONT_FAMILY_MAP } from "@/constants";
import { cn } from "@/utils/cn";
import { getSystemFontFamilies } from "@/lib/system-fonts";
import { resolveFontStackForDisplay } from "@/lib/fonts";

export const AppearanceProperties: React.FC<PropertyPanelProps<FormField>> = ({
  data,
  onChange,
  onTriggerHistorySave,
}) => {
  const { t } = useLanguage();
  const style = data.style || {};

  const [systemFamilies, setSystemFamilies] = React.useState<string[]>([]);

  const availableFontKeys = [
    ...Object.keys(FONT_FAMILY_MAP),
    ...systemFamilies,
  ];
  const currentFontValue = style.fontFamily || "Helvetica";
  const isCustomFontValue =
    !!style.fontFamily && !availableFontKeys.includes(style.fontFamily);

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

  const handleStyleChange = (key: string, value: unknown) => {
    onChange({
      style: {
        ...style,
        [key]: value,
      },
    });
  };

  return (
    <div>
      <h4 className="text-muted-foreground mb-3 flex items-center text-xs font-semibold tracking-wider uppercase">
        <Palette size={12} className="mr-1.5" />
        {t("properties.appearance")}
      </h4>
      <div className="space-y-4">
        {/* Background */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label>{t("properties.background")}</Label>
            <div className="flex items-center gap-2">
              <Switch
                id="transparent"
                checked={style.isTransparent || false}
                onMouseDown={onTriggerHistorySave}
                onCheckedChange={(checked) =>
                  handleStyleChange("isTransparent", checked)
                }
              />
              <Label htmlFor="transparent" className="text-xs font-normal">
                {t("properties.transparent")}
              </Label>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              disabled={style.isTransparent}
              value={style.backgroundColor || "#ffffff"}
              onMouseDown={onTriggerHistorySave}
              onChange={(e) =>
                handleStyleChange("backgroundColor", e.target.value)
              }
              className="border-input bg-background h-8 w-full cursor-pointer rounded border disabled:opacity-50"
            />
          </div>
        </div>

        {/* Border */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>{t("properties.border_color")}</Label>
            <input
              type="color"
              value={style.borderColor || "#000000"}
              onMouseDown={onTriggerHistorySave}
              onChange={(e) => handleStyleChange("borderColor", e.target.value)}
              className="border-input bg-background h-8 w-full cursor-pointer rounded border"
            />
          </div>
          <div className="space-y-2">
            <Label>{t("properties.border_width")}</Label>
            <NumberInput
              minValue={0}
              maxValue={10}
              value={style.borderWidth ?? 1}
              onFocus={onTriggerHistorySave}
              onChange={(val) => handleStyleChange("borderWidth", val)}
            />
          </div>
        </div>

        {/* Text Settings (For Text and Dropdown) */}
        {(data.type === FieldType.TEXT || data.type === FieldType.DROPDOWN) && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t("properties.font_size")}</Label>
                <NumberInput
                  minValue={6}
                  maxValue={72}
                  value={style.fontSize || 12}
                  formatOptions={{ maximumFractionDigits: 0 }}
                  onFocus={onTriggerHistorySave}
                  onChange={(val) => handleStyleChange("fontSize", val)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("properties.text_color")}</Label>
                <input
                  type="color"
                  value={style.textColor || "#000000"}
                  onMouseDown={onTriggerHistorySave}
                  onChange={(e) =>
                    handleStyleChange("textColor", e.target.value)
                  }
                  className="border-input bg-background h-8 w-full cursor-pointer rounded border"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("properties.font_family")}</Label>
              <Select
                value={currentFontValue}
                onValueChange={(val) => {
                  onTriggerHistorySave();
                  handleStyleChange("fontFamily", val);
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
                          style={{
                            fontFamily: resolveFontStackForDisplay(name),
                          }}
                        >
                          {name}
                        </span>
                      </SelectItem>
                    ))}
                  {isCustomFontValue && (
                    <SelectItem value={style.fontFamily as string}>
                      {style.fontFamily as string}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Alignment only for Text fields */}
            {data.type === FieldType.TEXT && (
              <div className="space-y-2">
                <Label>{t("properties.alignment")}</Label>
                <div className="bg-muted border-input flex rounded-md border p-1">
                  <button
                    onClick={() => {
                      onTriggerHistorySave();
                      onChange({ alignment: "left" });
                    }}
                    className={cn(
                      "text-foreground/50 hover:bg-background hover:text-foreground flex flex-1 justify-center rounded p-1 transition-colors",
                      (data.alignment || "left") === "left" &&
                        "bg-background text-foreground shadow-sm",
                    )}
                    title={t("properties.alignment_options.left")}
                  >
                    <AlignLeft size={16} />
                  </button>
                  <button
                    onClick={() => {
                      onTriggerHistorySave();
                      onChange({ alignment: "center" });
                    }}
                    className={cn(
                      "text-foreground/50 hover:bg-background hover:text-foreground flex flex-1 justify-center rounded p-1 transition-colors",
                      data.alignment === "center" &&
                        "bg-background text-foreground shadow-sm",
                    )}
                    title={t("properties.alignment_options.center")}
                  >
                    <AlignCenter size={16} />
                  </button>
                  <button
                    onClick={() => {
                      onTriggerHistorySave();
                      onChange({ alignment: "right" });
                    }}
                    className={cn(
                      "text-foreground/50 hover:bg-background hover:text-foreground flex flex-1 justify-center rounded p-1 transition-colors",
                      data.alignment === "right" &&
                        "bg-background text-foreground shadow-sm",
                    )}
                    title={t("properties.alignment_options.right")}
                  >
                    <AlignRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
