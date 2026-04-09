import React from "react";
import { Stamp, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { StampStylePopover } from "@/components/toolbar/StampStylePopover";
import { StampFace } from "@/components/stamps/StampFace";
import { normalizeRotationDeg } from "@/lib/controlRotation";
import {
  decodeStampImageDataUrl,
  getStampImageExtension,
  getSuggestedStampImageFilename,
} from "@/lib/stampImage";
import {
  DEFAULT_STAMP_OPACITY,
  normalizeStampOpacity,
  restoreStampRectAspectRatio,
} from "@/lib/stamps";
import { saveFileAs } from "@/services/platform/files";
import { FloatingToolbar } from "../FloatingToolbar";
import { ControlWrapper } from "../ControlWrapper";
import type { AnnotationControlProps } from "../types";
import { AnnotationAskAiButton } from "./AnnotationAskAiButton";

const getRotatedOuterRect = (
  rect: NonNullable<AnnotationControlProps["data"]["rect"]>,
  rotationDeg: number,
) => {
  if (!Number.isFinite(rotationDeg) || rotationDeg === 0) return undefined;

  const theta = (rotationDeg * Math.PI) / 180;
  const absCos = Math.abs(Math.cos(theta));
  const absSin = Math.abs(Math.sin(theta));
  const outerW = absCos * rect.width + absSin * rect.height;
  const outerH = absSin * rect.width + absCos * rect.height;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;

  return {
    x: cx - outerW / 2,
    y: cy - outerH / 2,
    width: outerW,
    height: outerH,
  };
};

export const StampControl: React.FC<AnnotationControlProps> = (props) => {
  const { t } = useLanguage();
  const {
    data,
    isSelected,
    onUpdate,
    onDelete,
    onAskAi,
    onTriggerHistorySave,
  } = props;

  if (data.type !== "stamp" || !data.rect) return null;
  const rect = data.rect;
  const stamp = data.stamp;
  const stampKind = stamp?.kind ?? "preset";
  const stampImage = stamp?.image;
  const stampAppearance = stamp?.appearance;
  const stampLabel = stamp?.label;
  const stampPresetId = stamp?.presetId;
  const stampIntrinsicSize = stampImage?.intrinsicSize;
  const stampImageData = stampImage?.dataUrl;

  const rotationDeg =
    typeof data.rotationDeg === "number" && Number.isFinite(data.rotationDeg)
      ? normalizeRotationDeg(data.rotationDeg)
      : 0;
  const rotatedOuterRect = getRotatedOuterRect(rect, rotationDeg);
  const outerRect = rotatedOuterRect ?? rect;
  const innerLeft = (outerRect.width - rect.width) / 2;
  const innerTop = (outerRect.height - rect.height) / 2;
  const opacity = normalizeStampOpacity(data.opacity, DEFAULT_STAMP_OPACITY);
  const canRestoreOriginalRatio =
    stampKind === "image" &&
    typeof stampIntrinsicSize?.width === "number" &&
    Number.isFinite(stampIntrinsicSize.width) &&
    stampIntrinsicSize.width > 0 &&
    typeof stampIntrinsicSize?.height === "number" &&
    Number.isFinite(stampIntrinsicSize.height) &&
    stampIntrinsicSize.height > 0;
  const canDownloadImage =
    stampKind === "image" &&
    typeof stampImageData === "string" &&
    stampImageData.length > 0;

  const handleRestoreOriginalRatio = React.useCallback(() => {
    if (!canRestoreOriginalRatio) return;

    const nextRect = restoreStampRectAspectRatio(rect, {
      width: stampIntrinsicSize!.width,
      height: stampIntrinsicSize!.height,
    });
    const changed =
      Math.abs(nextRect.x - rect.x) > 0.01 ||
      Math.abs(nextRect.y - rect.y) > 0.01 ||
      Math.abs(nextRect.width - rect.width) > 0.01 ||
      Math.abs(nextRect.height - rect.height) > 0.01;

    if (!changed) return;

    onTriggerHistorySave?.();
    onUpdate?.(data.id, {
      rect: nextRect,
      appearanceStreamContent: undefined,
    });
  }, [
    canRestoreOriginalRatio,
    data.id,
    onTriggerHistorySave,
    onUpdate,
    rect,
    stampIntrinsicSize,
  ]);

  const handleDownloadImage = React.useCallback(async () => {
    if (!canDownloadImage || !stampImageData) return;

    try {
      const { bytes, mimeType } = decodeStampImageDataUrl(stampImageData);
      const extension = getStampImageExtension(stampImageData);
      const saved = await saveFileAs({
        suggestedName: getSuggestedStampImageFilename(data.id, stampImageData),
        bytes,
        mimeType,
        filters: [
          {
            name: "Image",
            extensions: [extension],
          },
        ],
      });

      if (!saved) return;
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? `${t("stamp.download_error")}: ${error.message}`
          : t("stamp.download_error");
      toast.error(message);
    }
  }, [canDownloadImage, data.id, stampImageData, t]);

  const contextMenuContent =
    canRestoreOriginalRatio || canDownloadImage ? (
      <>
        {canRestoreOriginalRatio && (
          <ContextMenuItem onSelect={handleRestoreOriginalRatio}>
            {t("common.actions.restore_original_ratio")}
          </ContextMenuItem>
        )}
        {canDownloadImage && (
          <ContextMenuItem onSelect={() => void handleDownloadImage()}>
            {t("common.actions.download_image")}
          </ContextMenuItem>
        )}
      </>
    ) : undefined;

  return (
    <ControlWrapper
      {...props}
      customRect={rotatedOuterRect}
      showBorder={isSelected}
      resizable={true}
      contextMenuContent={contextMenuContent}
    >
      <FloatingToolbar isVisible={isSelected} sideOffset={32}>
        <StampStylePopover
          value={{
            kind: stampKind,
            presetId: stampPresetId,
            image: stampImage,
            imageAppearance: stampAppearance,
            opacity: data.opacity,
          }}
          onChange={(updates) => {
            const next: Partial<typeof data> = {
              appearanceStreamContent: undefined,
            };
            const nextStamp = {
              kind: stampKind,
              presetId: stampPresetId,
              label: stampLabel,
              image: stampImage,
              appearance: stampAppearance,
            };

            if (updates.kind === "preset") {
              nextStamp.kind = "preset";
              nextStamp.label = undefined;
              nextStamp.image = undefined;
              nextStamp.appearance = undefined;
            } else if (updates.kind === "image") {
              nextStamp.kind = "image";
            }

            if (updates.presetId !== undefined) {
              nextStamp.presetId = updates.presetId;
              nextStamp.label = undefined;
            }
            if (updates.image !== undefined) {
              nextStamp.image = updates.image;
            }
            if (updates.imageAppearance !== undefined) {
              nextStamp.appearance = updates.imageAppearance;
            }
            if (updates.opacity !== undefined) {
              next.opacity = updates.opacity;
            }
            next.stamp = nextStamp;

            onUpdate?.(data.id, next);
          }}
          title="Stamp Properties"
          side="top"
          align="center"
        >
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Stamp size={16} />
          </Button>
        </StampStylePopover>

        <AnnotationAskAiButton annotation={data} onAskAi={onAskAi} />

        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8"
          onClick={() => onDelete?.(data.id)}
        >
          <Trash2 size={16} />
        </Button>
      </FloatingToolbar>

      <div className="relative h-full w-full">
        <div
          className="absolute overflow-hidden"
          style={{
            left: `calc(${innerLeft}px * var(--scale, 1))`,
            top: `calc(${innerTop}px * var(--scale, 1))`,
            width: `calc(${data.rect.width}px * var(--scale, 1))`,
            height: `calc(${data.rect.height}px * var(--scale, 1))`,
            transform: `rotate(${rotationDeg}deg)`,
            transformOrigin: "50% 50%",
          }}
        >
          <StampFace
            kind={stampKind === "image" ? "image" : "preset"}
            presetId={stampPresetId}
            label={stampLabel}
            image={stampImage}
            imageAppearance={stampAppearance ?? { frame: "plain" }}
            opacity={opacity}
          />
        </div>
      </div>
    </ControlWrapper>
  );
};
