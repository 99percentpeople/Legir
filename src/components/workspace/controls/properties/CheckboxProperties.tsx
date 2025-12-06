import React from "react";
import { FormField } from "@/types";
import { PropertyPanelProps } from "./types";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Database, MousePointer2 } from "lucide-react";
import { useLanguage } from "@/components/language-provider";

export const CheckboxProperties: React.FC<PropertyPanelProps<FormField>> = ({
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
          <div className="flex items-center justify-between">
            <Label htmlFor="check-val">{t("properties.checked")}</Label>
            <Switch
              id="check-val"
              checked={data.isChecked || false}
              onCheckedChange={(checked) => {
                onTriggerHistorySave();
                onChange({ isChecked: checked });
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="check-def">{t("properties.default_checked")}</Label>
            <Switch
              id="check-def"
              checked={data.isDefaultChecked || false}
              onCheckedChange={(checked) => {
                onTriggerHistorySave();
                onChange({ isDefaultChecked: checked });
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("properties.export_value")}</Label>
            <Input
              type="text"
              value={data.exportValue || "Yes"}
              onFocus={onTriggerHistorySave}
              onChange={(e) => onChange({ exportValue: e.target.value })}
              placeholder="Yes"
            />
            <p className="text-muted-foreground text-xs">
              {t("properties.export_value.desc")}
            </p>
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
        </div>
      </div>
    </>
  );
};
