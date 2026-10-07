import type { ImageCompressionOptions } from "@/types";

export const DEFAULT_IMAGE_COMPRESSION: ImageCompressionOptions = {
  mode: "original",
  dpi: 150,
};

export const IMAGE_COMPRESSION_DPI_PRESETS = [72, 96, 150, 300, 600] as const;

export const normalizeImageCompression = (
  value?: Partial<ImageCompressionOptions>,
): ImageCompressionOptions => ({
  mode: value?.mode === "dpi" ? "dpi" : "original",
  dpi:
    typeof value?.dpi === "number" &&
    Number.isFinite(value.dpi) &&
    value.dpi > 0
      ? Math.min(1200, Math.max(36, Math.round(value.dpi)))
      : DEFAULT_IMAGE_COMPRESSION.dpi,
});
