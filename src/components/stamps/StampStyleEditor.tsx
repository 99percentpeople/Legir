import React from "react";
import { toast } from "sonner";

import { useLanguage } from "@/components/language-provider";
import { ImageUploadField } from "@/components/ui/image-upload-field";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { StampImageAppearance, StampImageResource } from "@/types";
import { cn } from "@/utils/cn";
import { loadStampImageFile } from "@/lib/stampImage";
import {
  DEFAULT_STAMP_OPACITY,
  DEFAULT_STAMP_PRESET_ID,
  normalizeStampKind,
  normalizeStampOpacity,
  STAMP_PRESETS,
  type StampKind,
  type StampPresetId,
} from "@/lib/stamps";
import { StampFace } from "./StampFace";

export interface StampStyleEditorValue {
  kind?: StampKind;
  presetId?: StampPresetId;
  image?: StampImageResource;
  imageAppearance?: StampImageAppearance;
  opacity?: number;
}

interface StampStyleEditorProps {
  value: StampStyleEditorValue | undefined;
  onChange: (updates: Partial<StampStyleEditorValue>) => void;
  onInteractionStart?: () => void;
  className?: string;
}

export const StampStyleEditor: React.FC<StampStyleEditorProps> = ({
  value,
  onChange,
  onInteractionStart,
  className,
}) => {
  const { t } = useLanguage();
  const kind = normalizeStampKind(value?.kind);
  const presetId = value?.presetId ?? DEFAULT_STAMP_PRESET_ID;
  const opacity = normalizeStampOpacity(value?.opacity, DEFAULT_STAMP_OPACITY);

  const handleImageUpload = async (file: File) => {
    onInteractionStart?.();

    try {
      const image = await loadStampImageFile(file);
      onChange({
        kind: "image",
        image: {
          dataUrl: image.dataUrl,
          intrinsicSize: {
            width: image.width,
            height: image.height,
          },
        },
        imageAppearance: {
          frame: "plain",
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("stamp.upload_error");
      toast.error(message);
    }
  };

  return (
    <div className={cn("space-y-4", className)}>
      <Tabs
        value={kind}
        onValueChange={(nextValue) => {
          if (nextValue !== "preset" && nextValue !== "image") return;
          onInteractionStart?.();
          onChange({ kind: nextValue });
        }}
        className="space-y-4"
      >
        <Label>{t("properties.stamp_type")}</Label>
        <TabsList className="grid h-9 w-full grid-cols-2">
          <TabsTrigger value="preset">
            {t("properties.preset_stamp")}
          </TabsTrigger>
          <TabsTrigger value="image">{t("properties.image_stamp")}</TabsTrigger>
        </TabsList>

        <TabsContent value="preset" className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {STAMP_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                aria-pressed={presetId === preset.id}
                className={cn(
                  "flex h-16 items-center justify-center rounded-md p-1 transition-transform outline-none",
                  "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                  presetId === preset.id
                    ? "scale-[1.03]"
                    : "hover:scale-[1.01]",
                )}
                onClick={() => {
                  onInteractionStart?.();
                  onChange({
                    kind: "preset",
                    presetId: preset.id,
                  });
                }}
              >
                <div className="flex h-full w-full items-center justify-center">
                  <StampFace
                    kind="preset"
                    presetId={preset.id}
                    opacity={opacity}
                    preserveAspectRatio="xMidYMid meet"
                    className="overflow-visible"
                  />
                </div>
              </button>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="image" className="space-y-2">
          <ImageUploadField
            imageData={value?.image?.dataUrl}
            alt={t("properties.image_stamp")}
            accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
            uploadLabel={t("properties.upload_image")}
            replaceLabel={t("properties.replace_image")}
            onUpload={handleImageUpload}
            preview={
              <StampFace
                kind="image"
                image={value?.image}
                imageAppearance={value?.imageAppearance ?? { frame: "plain" }}
                opacity={1}
                className="overflow-hidden rounded"
              />
            }
          />
        </TabsContent>
      </Tabs>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{t("properties.opacity")}</Label>
          <span className="text-muted-foreground text-xs">
            {Math.round(opacity * 100)}%
          </span>
        </div>
        <Slider
          value={[opacity]}
          min={0.05}
          max={1}
          step={0.05}
          onValueCommit={onInteractionStart}
          onValueChange={(values) => onChange({ opacity: values[0] })}
        />
      </div>
    </div>
  );
};
