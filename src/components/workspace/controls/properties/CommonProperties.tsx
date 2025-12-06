import React from "react";
import { FormField, FieldType } from "@/types";
import { PropertyPanelProps } from "./types";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings } from "lucide-react";
import { useLanguage } from "@/components/language-provider";

export const CommonProperties: React.FC<PropertyPanelProps<FormField>> = ({
  data,
  onChange,
  onTriggerHistorySave,
}) => {
  const { t } = useLanguage();

  return (
    <div>
      <h4 className="text-muted-foreground mb-3 flex items-center text-xs font-semibold tracking-wider uppercase">
        <Settings size={12} className="mr-1.5" />
        {t("properties.general")}
      </h4>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label>{t("properties.field_name")}</Label>
          <Input
            type="text"
            value={data.name}
            onFocus={onTriggerHistorySave}
            onChange={(e) => onChange({ name: e.target.value })}
          />
          <p className="text-muted-foreground text-xs">
            {t("properties.field_name.desc")}
          </p>
          {data.type === FieldType.RADIO && (
            <p className="mt-1 text-xs text-blue-500 dark:text-blue-400">
              {t("properties.radio_group.desc")}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>{t("properties.type")}</Label>
          <Select
            value={data.type}
            onValueChange={(value) => {
              onTriggerHistorySave();
              onChange({ type: value as FieldType });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("common.select")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FieldType.TEXT}>
                {t("properties.type.text")}
              </SelectItem>
              <SelectItem value={FieldType.CHECKBOX}>
                {t("properties.type.checkbox")}
              </SelectItem>
              <SelectItem value={FieldType.RADIO}>
                {t("properties.type.radio")}
              </SelectItem>
              <SelectItem value={FieldType.DROPDOWN}>
                {t("properties.type.dropdown")}
              </SelectItem>
              <SelectItem value={FieldType.SIGNATURE}>
                {t("properties.type.signature")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{t("properties.tooltip")}</Label>
          <Input
            type="text"
            value={data.toolTip || ""}
            onFocus={onTriggerHistorySave}
            onChange={(e) => onChange({ toolTip: e.target.value })}
            placeholder={t("properties.tooltip.ph")}
          />
        </div>
      </div>
    </div>
  );
};
