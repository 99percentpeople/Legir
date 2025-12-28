import React from "react";
import { FormField } from "@/types";
import { PropertyPanelProps } from "./types";
import { Label } from "@/components/ui/label";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Database, MousePointer2, Trash2, Upload } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { cn } from "@/lib/cn";

export const SignatureProperties: React.FC<PropertyPanelProps<FormField>> = ({
  data,
  onChange,
  onTriggerHistorySave,
}) => {
  const { t } = useLanguage();

  const handleSignatureUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onTriggerHistorySave();
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          onChange({ signatureData: ev.target.result as string });
        }
      };
      reader.readAsDataURL(e.target.files[0]);
    }
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
          <div className="border-input bg-muted/20 flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-4">
            {data.signatureData ? (
              <div className="border-border relative flex aspect-video w-full items-center justify-center overflow-hidden rounded border bg-white">
                <img
                  src={data.signatureData}
                  alt="Signature"
                  className={cn(
                    "max-h-full max-w-full",
                    data.imageScaleMode === "fill"
                      ? "h-full w-full object-fill"
                      : "object-contain",
                  )}
                />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-1 right-1 h-6 w-6"
                  onClick={() => {
                    onTriggerHistorySave();
                    onChange({ signatureData: undefined });
                  }}
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            ) : (
              <div className="text-muted-foreground text-center text-xs">
                {t("properties.no_signature")}
              </div>
            )}

            <label className="cursor-pointer">
              <Input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleSignatureUpload}
              />
              <div
                className={cn(
                  buttonVariants({ variant: "secondary", size: "sm" }),
                )}
              >
                <Upload size={14} className="mr-2" />
                {t("properties.upload_signature")}
              </div>
            </label>
          </div>
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
