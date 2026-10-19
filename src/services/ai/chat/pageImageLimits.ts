import {
  AI_CHAT_PAGE_IMAGE_MAX_DIMENSION,
  AI_CHAT_PAGE_IMAGE_MAX_PIXELS,
  AI_CHAT_PAGE_IMAGE_PIXEL_DENSITY,
} from "@/constants";

/** Decide the raster size before allocating a canvas or a PDFium bitmap. */
export const getPageImageRenderPlan = (
  width: number,
  height: number,
  preferredDensity = AI_CHAT_PAGE_IMAGE_PIXEL_DENSITY,
) => {
  if (
    ![width, height, preferredDensity].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    throw new Error("Invalid page image dimensions.");
  }
  const pixelDensity = Math.min(
    preferredDensity,
    AI_CHAT_PAGE_IMAGE_MAX_DIMENSION / width,
    AI_CHAT_PAGE_IMAGE_MAX_DIMENSION / height,
    Math.sqrt(AI_CHAT_PAGE_IMAGE_MAX_PIXELS / width / height),
  );
  return {
    pixelDensity,
    renderedWidth: Math.max(1, Math.floor(width * pixelDensity)),
    renderedHeight: Math.max(1, Math.floor(height * pixelDensity)),
    downscaled: pixelDensity < AI_CHAT_PAGE_IMAGE_PIXEL_DENSITY,
  };
};

/** Read dimensions without decoding a potentially huge historical raster. */
export const readPageImageDimensions = (bytes: Uint8Array) => {
  if (
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = bytes[offset]! * 256 + bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) return null;
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf,
      ].includes(marker)
    ) {
      if (length < 8) return null;
      return {
        height: bytes[offset + 3]! * 256 + bytes[offset + 4]!,
        width: bytes[offset + 5]! * 256 + bytes[offset + 6]!,
      };
    }
    offset += length;
  }
  return null;
};

export const isPageImageWithinPixelBudget = (size: {
  width: number;
  height: number;
}) =>
  size.width > 0 &&
  size.height > 0 &&
  size.width <= AI_CHAT_PAGE_IMAGE_MAX_DIMENSION &&
  size.height <= AI_CHAT_PAGE_IMAGE_MAX_DIMENSION &&
  size.width * size.height <= AI_CHAT_PAGE_IMAGE_MAX_PIXELS;
