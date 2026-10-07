import type { ImageCompressionOptions } from "@/types";
import { normalizeImageCompression } from "@/lib/imageCompression";
import { decodeStampImageDataUrl } from "@/lib/stampImage";

type ImageSize = { width: number; height: number };

// The placement is in physical PDF points (72 per inch), never screen pixels.
export const getImageExportPixelSize = (
  source: ImageSize,
  placement: ImageSize,
  options?: ImageCompressionOptions,
): ImageSize => {
  const compression = normalizeImageCompression(options);
  if (
    compression.mode === "original" ||
    ![source.width, source.height, placement.width, placement.height].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    return source;
  // Keep enough pixels on both axes, even when the image is stretched on-page.
  const ratio = Math.min(
    1,
    Math.max(
      (placement.width * compression.dpi) / 72 / source.width,
      (placement.height * compression.dpi) / 72 / source.height,
    ),
  );
  return {
    width: Math.min(source.width, Math.max(1, Math.ceil(source.width * ratio))),
    height: Math.min(
      source.height,
      Math.max(1, Math.ceil(source.height * ratio)),
    ),
  };
};

const loadImageSource = async (
  blob: Blob,
): Promise<ImageBitmap | HTMLImageElement> => {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Some WebViews expose createImageBitmap but cannot decode every format.
    }
  }
  if (typeof Image === "undefined" || typeof URL === "undefined") {
    throw new Error("Image rasterization is unavailable in this environment.");
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to decode stamp image."));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const encodeImage = async (
  source: CanvasImageSource,
  size: ImageSize,
  mimeType: "image/png" | "image/jpeg",
) => {
  const canvas =
    typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(size.width, size.height)
      : (() => {
          if (typeof document === "undefined")
            throw new Error(
              "Canvas rasterization is unavailable in this environment.",
            );
          const canvas = document.createElement("canvas");
          canvas.width = size.width;
          canvas.height = size.height;
          return canvas;
        })();
  try {
    const context = canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!context)
      throw new Error("Failed to initialize canvas for stamp image.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, size.width, size.height);
    const blob =
      "convertToBlob" in canvas
        ? await canvas.convertToBlob({ type: mimeType, quality: 0.9 })
        : await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (blob) =>
                blob
                  ? resolve(blob)
                  : reject(new Error("Failed to encode stamp image.")),
              mimeType,
              0.9,
            );
          });
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mimeType: blob.type,
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
};

export const prepareStampImageForPdf = async (options: {
  dataUrl: string;
  placement: ImageSize;
  compression?: ImageCompressionOptions;
}) => {
  const original = decodeStampImageDataUrl(options.dataUrl);
  const canEmbedOriginal = ["image/png", "image/jpeg", "image/jpg"].includes(
    original.mimeType,
  );
  const compression = normalizeImageCompression(options.compression);
  if (canEmbedOriginal && compression.mode === "original") return original;

  let source: ImageBitmap | HTMLImageElement | undefined;
  try {
    source = await loadImageSource(
      new Blob([original.bytes], { type: original.mimeType }),
    );
    const originalSize =
      "naturalWidth" in source
        ? { width: source.naturalWidth, height: source.naturalHeight }
        : { width: source.width, height: source.height };
    const size = getImageExportPixelSize(
      originalSize,
      options.placement,
      compression,
    );
    if (
      canEmbedOriginal &&
      size.width === originalSize.width &&
      size.height === originalSize.height
    )
      return original;
    // PNG retains transparent edges; JPEG stays JPEG. Other raster formats
    // must be converted for PDF embedding, but keep their native resolution.
    return await encodeImage(
      source,
      size,
      /^image\/jpe?g$/.test(original.mimeType) ? "image/jpeg" : "image/png",
    );
  } catch (error) {
    // A failed optimization must not make a previously exportable image vanish.
    if (!canEmbedOriginal) throw error;
    console.warn(
      "Could not compress stamp image; keeping original resolution",
      error,
    );
    return original;
  } finally {
    if (source && "close" in source) source.close();
  }
};
