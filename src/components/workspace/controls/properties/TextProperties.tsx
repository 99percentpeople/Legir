import React from "react";
import { FormField } from "@/types";
import { PropertyPanelProps } from "./types";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { NumberInput } from "@/components/ui/number-input";
import { Separator } from "@/components/ui/separator";
import {
  Database,
  MousePointer2,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { cn } from "@/lib/cn";

export const TextProperties: React.FC<PropertyPanelProps<FormField>> = ({
  data,
  onChange,
  onTriggerHistorySave,
}) => {
  const { t } = useLanguage();

  return (
    <>
      {/* Values & Defaults Section */}
      <div>
        <h4 className="text-muted-foreground mb-3 flex items-center text-xs font-semibold tracking-wider uppercase">
          <Database size={12} className="mr-1.5" />
          {t("properties.values_defaults")}
        </h4>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>{t("properties.value")}</Label>
            {data.multiline ? (
              <Textarea
                value={data.value || ""}
                onFocus={onTriggerHistorySave}
                onChange={(e) => onChange({ value: e.target.value })}
                className="min-h-16 resize-y"
              />
            ) : (
              <Input
                type="text"
                value={data.value || ""}
                onFocus={onTriggerHistorySave}
                onChange={(e) => onChange({ value: e.target.value })}
              />
            )}
          </div>
          <div className="space-y-2">
            <Label>{t("properties.default_value")}</Label>
            {data.multiline ? (
              <Textarea
                value={data.defaultValue || ""}
                onFocus={onTriggerHistorySave}
                onChange={(e) => onChange({ defaultValue: e.target.value })}
                className="min-h-16 resize-y"
              />
            ) : (
              <Input
                type="text"
                value={data.defaultValue || ""}
                onFocus={onTriggerHistorySave}
                onChange={(e) => onChange({ defaultValue: e.target.value })}
              />
            )}
          </div>
        </div>
      </div>

      <Separator />

      {/* Settings / Behavior */}
      <div>
        <h4 className="text-muted-foreground mb-3 flex items-center text-xs font-semibold tracking-wider uppercase">
          <MousePointer2 size={12} className="mr-1.5" />
          {t("properties.settings")}
        </h4>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="required-switch" className="cursor-pointer">
              {t("properties.required")}
            </Label>
            <Switch
              id="required-switch"
              checked={data.required || false}
              onMouseDown={onTriggerHistorySave}
              onCheckedChange={(checked) => onChange({ required: checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="readonly-switch" className="cursor-pointer">
              {t("properties.readonly")}
            </Label>
            <Switch
              id="readonly-switch"
              checked={data.readOnly || false}
              onMouseDown={onTriggerHistorySave}
              onCheckedChange={(checked) => onChange({ readOnly: checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="multiline-switch" className="cursor-pointer">
              {t("properties.multiline")}
            </Label>
            <Switch
              id="multiline-switch"
              checked={data.multiline || false}
              onMouseDown={onTriggerHistorySave}
              onCheckedChange={(checked) => onChange({ multiline: checked })}
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Specific Properties */}
      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>{t("properties.max_length")}</Label>
            <NumberInput
              minValue={0}
              formatOptions={{ maximumFractionDigits: 0 }}
              value={data.maxLength || NaN}
              onFocus={onTriggerHistorySave}
              onChange={(val) =>
                onChange({ maxLength: isNaN(val) ? undefined : val })
              }
            />
          </div>
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
        </div>
      </div>
    </>
  );
};
