import React from "react";
import { FormField } from "@/types";
import { PropertyPanelProps } from "./types";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Database, MousePointer2 } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { ImageUploadField } from "@/components/ui/image-upload-field";

export const SignatureProperties: React.FC<PropertyPanelProps<FormField>> = ({
  data,
  onChange,
  onTriggerHistorySave,
}) => {
  const { t } = useLanguage();

  const handleSignatureUpload = (file: File) => {
    onTriggerHistorySave();
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) {
        onChange({ signatureData: ev.target.result as string });
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      {/* Values & Defaults Section */}
      <div>
        <h4 className="text-muted-foreground mb-3 flex items-center text-xs font-semibold tracking-wider uppercase">
          <Database size={12} className="mr-1.5" />
          {t("properties.values_defaults")}
        </h4>
        <div className="space-y-3">
          <Label>{t("properties.signature_image")}</Label>
          <ImageUploadField
            imageData={data.signatureData}
            alt={t("properties.signature_image")}
            uploadLabel={t("properties.upload_signature")}
            replaceLabel={t("properties.upload_signature")}
            onUpload={handleSignatureUpload}
            onClear={() => {
              onTriggerHistorySave();
              onChange({ signatureData: undefined });
            }}
            emptyState={
              <div className="text-muted-foreground text-center text-xs">
                {t("properties.no_signature")}
              </div>
            }
            imageClassName={
              data.imageScaleMode === "fill"
                ? "h-full w-full object-fill"
                : "object-contain"
            }
          />
        </div>

        <div className="mt-3 space-y-2">
          <Label>{t("properties.scale_mode")}</Label>
          <Select
            value={data.imageScaleMode || "contain"}
            onValueChange={(val) => {
              onTriggerHistorySave();
              onChange({ imageScaleMode: val as "contain" | "fill" });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="contain">
                {t("properties.scale_mode.contain")}
              </SelectItem>
              <SelectItem value="fill">
                {t("properties.scale_mode.fill")}
              </SelectItem>
            </SelectContent>
          </Select>
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
