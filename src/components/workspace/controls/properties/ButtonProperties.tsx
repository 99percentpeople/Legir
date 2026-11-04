import React from "react";
import { toast } from "sonner";
import type { FormField } from "@/types";
import type { PropertyPanelProps } from "./types";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ImageUploadField,
  type ImageUploadContext,
} from "@/components/ui/image-upload-field";
import { useLanguage } from "@/components/language-provider";
import { readButtonImageFile } from "../form/buttonImageFile";

export const ButtonProperties: React.FC<PropertyPanelProps<FormField>> = ({
  data,
  onChange,
  onTriggerHistorySave,
}) => {
  const { t } = useLanguage();
  const id = React.useId();
  const fit: NonNullable<FormField["buttonImageFit"]> = data.buttonImageFit ?? {
    scaleMode: "contain",
    alignment: [0.5, 0.5],
    when: "always",
    fitBounds: false,
  };
  const change = (patch: Partial<FormField>) => {
    onTriggerHistorySave();
    onChange(patch);
  };
  const upload = async (file: File, { signal }: ImageUploadContext) => {
    const buttonImage = await readButtonImageFile(file);
    if (signal.aborted) return;
    change({
      buttonImage,
      buttonLayout: (data.buttonLayout ?? 0) === 0 ? 1 : data.buttonLayout,
    });
  };
  const image =
    data.buttonImage === null
      ? undefined
      : (data.buttonImage ?? data.buttonIconPreview);
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${id}-caption`}>
          {t("properties.button_caption")}
        </Label>
        <Input
          id={`${id}-caption`}
          value={data.buttonCaption ?? ""}
          onFocus={onTriggerHistorySave}
          onChange={(event) => onChange({ buttonCaption: event.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-layout`}>{t("properties.button_layout")}</Label>
        <Select
          value={String(data.buttonLayout ?? 0)}
          onValueChange={(v) =>
            change({ buttonLayout: Number(v) as FormField["buttonLayout"] })
          }
        >
          <SelectTrigger id={`${id}-layout`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[0, 1, 2, 3, 4, 5, 6].map((v) => (
              <SelectItem key={v} value={String(v)}>
                {t(`properties.button_layout_${v}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>{t("properties.button_image")}</Label>
        <ImageUploadField
          imageData={image}
          selectionKey={data.id}
          alt={t("properties.button_image")}
          accept="image/png,image/jpeg"
          uploadLabel={t("properties.button_upload")}
          replaceLabel={t("properties.button_replace")}
          onUpload={upload}
          onUploadError={() => toast.error(t("properties.button_image_error"))}
          clearLabel={t("common.actions.delete")}
          onClear={() => change({ buttonImage: null })}
          emptyState={
            <p className="text-muted-foreground text-xs">
              {t("properties.button_empty")}
            </p>
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-fit`}>{t("properties.scale_mode")}</Label>
        <Select
          value={fit.scaleMode}
          onValueChange={(v) =>
            change({
              buttonImageFit: { ...fit, scaleMode: v as "contain" | "fill" },
            })
          }
        >
          <SelectTrigger id={`${id}-fit`} className="w-full">
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
      <div className="flex items-center justify-between">
        <Label htmlFor={`${id}-readonly`}>{t("properties.readonly")}</Label>
        <Switch
          id={`${id}-readonly`}
          checked={!!data.readOnly}
          onCheckedChange={(readOnly) => change({ readOnly })}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        {t("properties.button_actions_note")}
      </p>
    </div>
  );
};
