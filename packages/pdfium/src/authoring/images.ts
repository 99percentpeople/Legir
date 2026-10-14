// Copyright (c) 2026 Legir contributors. BSD-3-Clause.
import { decode, convertIndexedToRgb } from "fast-png";
import { PDFContext, PDFRef } from "./objects.js";
export function decodeImageInput(
  input: Uint8Array | ArrayBuffer | string,
): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (typeof input !== "string") return new Uint8Array(input);
  const data = input.startsWith("data:")
    ? input.slice(input.indexOf(",") + 1)
    : input;
  const decoded = atob(data.replace(/\s/g, ""));
  return Uint8Array.from(decoded, (c) => c.charCodeAt(0));
}
export class PDFImage {
  constructor(
    readonly ref: PDFRef,
    readonly width: number,
    readonly height: number,
  ) {}
  size() {
    return { width: this.width, height: this.height };
  }
  scale(factor: number) {
    return { width: this.width * factor, height: this.height * factor };
  }
  scaleToFit(width: number, height: number) {
    return this.scale(Math.min(width / this.width, height / this.height));
  }
  async embed() {}
}
export function embedJpeg(context: PDFContext, bytes: Uint8Array) {
  if (bytes[0] !== 255 || bytes[1] !== 216)
    throw new Error("Invalid JPEG signature");
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset++] !== 255) continue;
    let marker = bytes[offset++];
    while (marker === 255) marker = bytes[offset++];
    if (
      marker === 0 ||
      marker === 216 ||
      marker === 217 ||
      (marker >= 208 && marker <= 215)
    )
      continue;
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length)
      throw new Error("Truncated JPEG");
    if (
      [
        192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
      ].includes(marker)
    ) {
      const depth = bytes[offset + 2],
        height = bytes[offset + 3] * 256 + bytes[offset + 4],
        width = bytes[offset + 5] * 256 + bytes[offset + 6],
        channels = bytes[offset + 7];
      if (!width || !height || ![1, 3, 4].includes(channels))
        throw new Error("Unsupported JPEG color space");
      const ref = context.register(
        context.stream(bytes, {
          Type: "XObject",
          Subtype: "Image",
          Width: width,
          Height: height,
          BitsPerComponent: depth,
          ColorSpace:
            channels === 1
              ? "DeviceGray"
              : channels === 4
                ? "DeviceCMYK"
                : "DeviceRGB",
          Filter: "DCTDecode",
          ...(channels === 4 ? { Decode: [1, 0, 1, 0, 1, 0, 1, 0] } : {}),
        }),
      );
      return new PDFImage(ref, width, height);
    }
    offset += length;
  }
  throw new Error("JPEG dimensions not found");
}
export function embedPng(context: PDFContext, bytes: Uint8Array) {
  // Bound allocations before the PNG decoder inflates IDAT data.
  if (
    bytes.length < 33 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
  )
    throw new Error("Invalid PNG signature");
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pixelCount = header.getUint32(16) * header.getUint32(20);
  if (!pixelCount || pixelCount > 268435456)
    throw new Error("PNG exceeds the pixel budget");
  const png = decode(bytes),
    { width, height } = png;
  let data = png.data,
    channels = png.channels,
    depth = png.depth;
  if (png.palette) {
    data = convertIndexedToRgb(png);
    channels = data.length / (width * height);
    depth = 8;
  }
  const hasAlpha = channels === 2 || channels === 4,
    colorChannels = channels >= 3 ? 3 : 1;
  const bytesPerSample = depth === 16 ? 2 : 1;
  // PDF and PNG both pack low-depth gray rows MSB-first. Preserve these rows
  // directly; expanding them loses transparency keys and needlessly uses memory.
  const color =
    !hasAlpha && depth !== 16
      ? (data as Uint8Array)
      : new Uint8Array(width * height * colorChannels * bytesPerSample);
  const alpha = hasAlpha
    ? new Uint8Array(width * height * bytesPerSample)
    : undefined;
  const put = (out: Uint8Array, index: number, value: number) => {
    if (bytesPerSample === 2) {
      out[index * 2] = value >> 8;
      out[index * 2 + 1] = value & 255;
    } else out[index] = value;
  };
  if (hasAlpha || depth === 16)
    for (let pixel = 0; pixel < width * height; pixel++) {
      for (let channel = 0; channel < colorChannels; channel++)
        put(
          color,
          pixel * colorChannels + channel,
          Number(data[pixel * channels + channel]),
        );
      if (alpha)
        put(alpha, pixel, Number(data[pixel * channels + channels - 1]));
    }
  const smask = alpha
    ? context.register(
        context.flateStream(alpha, {
          Type: "XObject",
          Subtype: "Image",
          Width: width,
          Height: height,
          BitsPerComponent: depth,
          ColorSpace: "DeviceGray",
        }),
      )
    : undefined;
  const mask =
    !alpha && png.transparency
      ? Array.from(png.transparency).flatMap((value) => [value, value])
      : undefined;
  const alternate = colorChannels === 1 ? "DeviceGray" : "DeviceRGB";
  const profile = png.iccEmbeddedProfile?.profile;
  const colorSpace = profile
    ? [
        "ICCBased",
        context.register(
          context.flateStream(profile, {
            N: colorChannels,
            Alternate: alternate,
          }),
        ),
      ]
    : alternate;
  const ref = context.register(
    context.flateStream(color, {
      Type: "XObject",
      Subtype: "Image",
      Width: width,
      Height: height,
      BitsPerComponent: depth,
      ColorSpace: colorSpace,
      SMask: smask,
      Mask: mask,
    }),
  );
  return new PDFImage(ref, width, height);
}
