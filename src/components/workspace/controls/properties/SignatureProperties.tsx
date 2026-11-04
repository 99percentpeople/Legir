import React from "react";
import type { FormField } from "@/types";
import type { PropertyPanelProps } from "./types";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/components/language-provider";

export const SignatureProperties: React.FC<PropertyPanelProps<FormField>> = ({
  data,
  onChange,
  onTriggerHistorySave,
}) => {
  const { t } = useLanguage();
  const id = React.useId();
  const info = data.signature;
  const populated = !!info?.present;
  const change = (patch: Partial<FormField>) => {
    if (populated) return;
    onTriggerHistorySave();
    onChange(patch);
  };
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>{t("properties.signature_state")}</Label>
        <p className="text-sm">
          {t(
            populated
              ? "properties.signature_present"
              : "properties.signature_empty",
          )}
        </p>
      </div>
      <p className="text-muted-foreground text-xs">
        {t(
          populated
            ? "properties.signature_unverified"
            : "properties.signature_hint",
        )}
      </p>
      {populated && (
        <>
          {[
            ["signature_signer", info?.name],
            ["signature_reason", info?.reason],
            ["signature_location", info?.location],
            ["signature_date", info?.date],
          ].map(([key, value]) =>
            value ? (
              <div key={key} className="space-y-1">
                <Label>{t(`properties.${key}`)}</Label>
                <p className="text-sm break-words">{value}</p>
              </div>
            ) : null,
          )}
          <p className="text-muted-foreground text-xs">
            {t("properties.signature_edit_warning")}
          </p>
        </>
      )}
      <div className="flex items-center justify-between">
        <Label htmlFor={`${id}-required`}>{t("properties.required")}</Label>
        <Switch
          id={`${id}-required`}
          checked={!!data.required}
          disabled={populated}
          onCheckedChange={(required) => change({ required })}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor={`${id}-readonly`}>{t("properties.readonly")}</Label>
        <Switch
          id={`${id}-readonly`}
          checked={!!data.readOnly}
          disabled={populated}
          onCheckedChange={(readOnly) => change({ readOnly })}
        />
      </div>
    </div>
  );
};
