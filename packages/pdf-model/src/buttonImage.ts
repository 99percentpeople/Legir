/** Portable limits shared by local button-image uploads and headless template exports. */
export const MAX_BUTTON_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_BUTTON_IMAGE_PIXELS = 32_000_000;
export type ButtonImageInfo = {
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
};

/** Inspect headers before a browser or PNG decoder allocates the image's pixel buffer. */
export function inspectButtonImage(bytes: Uint8Array): ButtonImageInfo {
  if (bytes.length > MAX_BUTTON_IMAGE_BYTES)
    throw new Error("Button image exceeds 20 MiB");
  let width = 0,
    height = 0;
  let mimeType: ButtonImageInfo["mimeType"];
  if (
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value,
    )
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(12) !== 0x49484452)
      throw new Error("PNG is missing its IHDR header");
    width = view.getUint32(16);
    height = view.getUint32(20);
    mimeType = "image/png";
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    mimeType = "image/jpeg";
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 255) throw new Error("Invalid JPEG marker");
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218 || marker === undefined) break;
      if (marker === 1 || (marker >= 208 && marker <= 216)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes[offset] * 256 + bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length)
        throw new Error("Truncated JPEG segment");
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      ) {
        if (length < 8) throw new Error("Invalid JPEG frame header");
        height = bytes[offset + 3] * 256 + bytes[offset + 4];
        width = bytes[offset + 5] * 256 + bytes[offset + 6];
        break;
      }
      offset += length;
    }
  } else throw new Error("Button images must be PNG or JPEG");
  if (!width || !height || width * height > MAX_BUTTON_IMAGE_PIXELS)
    throw new Error("Invalid image dimensions or image exceeds 32 megapixels");
  return { mimeType, width, height };
}

export function decodeButtonImage(dataUrl: string) {
  if (dataUrl.length > Math.ceil(MAX_BUTTON_IMAGE_BYTES / 3) * 4 + 64)
    throw new Error("Button image exceeds 20 MiB");
  const match = /^data:image\/(png|jpe?g);base64,([a-z0-9+/=\s]+)$/i.exec(
    dataUrl,
  );
  if (!match) throw new Error("Button images must be PNG or JPEG data URLs");
  const bytes = Uint8Array.from(atob(match[2]), (value) => value.charCodeAt(0));
  const info = inspectButtonImage(bytes);
  if (
    info.mimeType !==
    (match[1].toLowerCase() === "png" ? "image/png" : "image/jpeg")
  )
    throw new Error("Image MIME type does not match its contents");
  return { bytes, ...info };
}

export function encodeButtonImage(bytes: Uint8Array): string {
  const { mimeType } = inspectButtonImage(bytes);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:${mimeType};base64,${btoa(binary)}`;
}
