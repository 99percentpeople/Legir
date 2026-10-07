import React from "react";
import { Image as ImageIcon } from "lucide-react";

import type { StampImageAppearance, StampImageResource } from "@/types";
import { cn } from "@/utils/cn";
import {
  DEFAULT_STAMP_HEIGHT,
  DEFAULT_STAMP_WIDTH,
  getPresetStampSvgDataUrl,
  type StampKind,
  type StampPresetId,
} from "@/lib/stamps";

interface StampFaceProps {
  kind: StampKind;
  presetId?: StampPresetId;
  label?: string | null;
  image?: StampImageResource;
  imageAppearance?: StampImageAppearance;
  opacity?: number;
  className?: string;
  viewBoxWidth?: number;
  viewBoxHeight?: number;
  preserveAspectRatio?: string;
}

export const StampFace: React.FC<StampFaceProps> = ({
  kind,
  presetId,
  label,
  image,
  imageAppearance,
  opacity = 1,
  className,
  viewBoxWidth = DEFAULT_STAMP_WIDTH,
  viewBoxHeight = DEFAULT_STAMP_HEIGHT,
  preserveAspectRatio = "none",
}) => {
  if (kind === "image") {
    const imageData = image?.dataUrl;
    const imageBox = imageAppearance?.box;
    const imageFrame = imageAppearance?.frame ?? "card";

    if (!imageData) {
      return (
        <div
          className={cn(
            "bg-muted/30 text-muted-foreground flex h-full w-full items-center justify-center rounded border border-dashed",
            className,
          )}
          style={{ opacity }}
        >
          <ImageIcon size={18} />
        </div>
      );
    }

    const inset = Math.max(2, Math.min(viewBoxWidth, viewBoxHeight) * 0.03);
    const normalizedImageBox = imageBox ?? {
      x: imageFrame === "plain" ? 0 : inset / viewBoxWidth,
      y: imageFrame === "plain" ? 0 : inset / viewBoxHeight,
      width:
        imageFrame === "plain"
          ? 1
          : Math.max(0, (viewBoxWidth - inset * 2) / viewBoxWidth),
      height:
        imageFrame === "plain"
          ? 1
          : Math.max(0, (viewBoxHeight - inset * 2) / viewBoxHeight),
    };
    const imageX = normalizedImageBox.x * viewBoxWidth;
    const imageY = normalizedImageBox.y * viewBoxHeight;
    const imageWidth = normalizedImageBox.width * viewBoxWidth;
    const imageHeight = normalizedImageBox.height * viewBoxHeight;
    const intrinsic = image?.intrinsicSize;
    const useSvgViewport =
      imageData.startsWith("data:image/svg+xml") &&
      intrinsic &&
      Number.isFinite(intrinsic.width) &&
      intrinsic.width > 0 &&
      Number.isFinite(intrinsic.height) &&
      intrinsic.height > 0;

    return (
      <div
        className={cn(
          "relative h-full w-full",
          imageFrame !== "plain" && "overflow-hidden rounded-[4px]",
          className,
        )}
        style={{
          opacity,
          ...(imageFrame !== "plain"
            ? {
                border: "1px solid #d4d4d8",
              }
            : null),
        }}
      >
        <div
          className="absolute"
          style={{
            left: `${(imageX / viewBoxWidth) * 100}%`,
            top: `${(imageY / viewBoxHeight) * 100}%`,
            width: `${(imageWidth / viewBoxWidth) * 100}%`,
            height: `${(imageHeight / viewBoxHeight) * 100}%`,
          }}
        >
          {useSvgViewport ? (
            <svg
              className="h-full w-full"
              viewBox={`0 0 ${intrinsic.width} ${intrinsic.height}`}
              preserveAspectRatio={
                imageAppearance?.scaleMode === "fill" ? "none" : "xMidYMid meet"
              }
              aria-hidden="true"
            >
              {/* Scale the intrinsic SVG image, preserving its internal alignment. */}
              <image
                href={imageData}
                width={intrinsic.width}
                height={intrinsic.height}
              />
            </svg>
          ) : (
            <img
              src={imageData}
              alt=""
              draggable={false}
              className={cn(
                "h-full w-full object-center",
                imageAppearance?.scaleMode === "fill"
                  ? "object-fill"
                  : "object-contain",
              )}
            />
          )}
        </div>
      </div>
    );
  }

  const presetSvgDataUrl = getPresetStampSvgDataUrl({
    presetId,
    label,
  });

  return (
    <div className={cn("h-full w-full", className)} style={{ opacity }}>
      <img
        src={presetSvgDataUrl}
        alt=""
        draggable={false}
        className={cn(
          "h-full w-full",
          preserveAspectRatio === "none" ? "object-fill" : "object-contain",
        )}
      />
    </div>
  );
};
