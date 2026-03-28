import { convertUint8ArrayToBase64 } from "@ai-sdk/provider-utils";

import type { AiChatMessageRecord } from "@/services/ai/chat/types";

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const getBase64Payload = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("data:")) {
    const commaIndex = trimmed.indexOf(",");
    if (commaIndex < 0) return null;
    const header = trimmed.slice(0, commaIndex);
    const payload = trimmed.slice(commaIndex + 1);
    const mediaTypeMatch = header.match(/^data:([^;,]+)?;/i);
    return {
      base64: payload,
      mediaType:
        typeof mediaTypeMatch?.[1] === "string" && mediaTypeMatch[1]
          ? mediaTypeMatch[1]
          : undefined,
      preserveDataUrl: true,
    };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  return {
    base64: trimmed,
    mediaType: undefined,
    preserveDataUrl: false,
  };
};

const decodeBase64ToUint8Array = (value: string) => {
  if (typeof atob !== "function") {
    throw new Error(
      "Base64 image decoding is unavailable in this environment.",
    );
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const loadCanvasImageSource = async (
  base64: string,
  mediaType: string,
): Promise<CanvasImageSource> => {
  const bytes = decodeBase64ToUint8Array(base64);
  const blob = new Blob([bytes], { type: mediaType || "image/png" });

  if (typeof createImageBitmap === "function") {
    return await createImageBitmap(blob);
  }

  if (typeof Image === "undefined" || typeof URL === "undefined") {
    throw new Error("Image resizing is unavailable in this environment.");
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to decode image data."));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const releaseCanvasImageSource = (source: CanvasImageSource) => {
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    source.close();
  }
};

const getCanvasImageSourceDimensions = (source: CanvasImageSource) => {
  if (
    typeof source === "object" &&
    source !== null &&
    "naturalWidth" in source &&
    "naturalHeight" in source &&
    typeof source.naturalWidth === "number" &&
    typeof source.naturalHeight === "number"
  ) {
    return {
      width: source.naturalWidth,
      height: source.naturalHeight,
    };
  }

  if (
    typeof source === "object" &&
    source !== null &&
    "width" in source &&
    "height" in source &&
    typeof source.width === "number" &&
    typeof source.height === "number"
  ) {
    return {
      width: source.width,
      height: source.height,
    };
  }

  return null;
};

const createRasterSurface = (width: number, height: number) => {
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }

  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return { canvas, context: canvas.getContext("2d") };
  }

  throw new Error("Canvas rendering is unavailable in this environment.");
};

const canvasToImageBytes = async (
  canvas: OffscreenCanvas | HTMLCanvasElement,
  mediaType: string,
) => {
  const normalizedMediaType = SUPPORTED_IMAGE_MIME_TYPES.has(mediaType)
    ? mediaType
    : "image/png";
  const blob =
    typeof OffscreenCanvas === "function" && canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({
          type: normalizedMediaType,
          ...(normalizedMediaType === "image/jpeg" ||
          normalizedMediaType === "image/webp"
            ? { quality: 0.9 }
            : null),
        })
      : await new Promise<Blob>((resolve, reject) => {
          (canvas as HTMLCanvasElement).toBlob(
            (value) => {
              if (value) {
                resolve(value);
                return;
              }
              reject(new Error("Failed to encode resized image."));
            },
            normalizedMediaType,
            normalizedMediaType === "image/jpeg" ||
              normalizedMediaType === "image/webp"
              ? 0.9
              : undefined,
          );
        });

  return {
    mediaType: blob.type || normalizedMediaType,
    bytes: new Uint8Array(await blob.arrayBuffer()),
  };
};

const downscaleBase64Image = async (options: {
  value: string;
  mediaType?: string;
  scale: number;
}) => {
  const payload = getBase64Payload(options.value);
  if (!payload) return null;

  const resolvedMediaType =
    options.mediaType?.trim() || payload.mediaType?.trim() || "image/png";
  const safeScale = Math.max(0, Math.min(1, options.scale));
  if (safeScale >= 0.999) {
    return {
      value: options.value,
      mediaType: resolvedMediaType,
    };
  }

  const source = await loadCanvasImageSource(payload.base64, resolvedMediaType);

  try {
    const dimensions = getCanvasImageSourceDimensions(source);
    const sourceWidth = Math.max(1, Math.round(dimensions?.width ?? 0));
    const sourceHeight = Math.max(1, Math.round(dimensions?.height ?? 0));
    if (sourceWidth <= 1 || sourceHeight <= 1) {
      return {
        value: options.value,
        mediaType: resolvedMediaType,
      };
    }

    const targetWidth = Math.max(1, Math.round(sourceWidth * safeScale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * safeScale));
    if (targetWidth >= sourceWidth && targetHeight >= sourceHeight) {
      return {
        value: options.value,
        mediaType: resolvedMediaType,
      };
    }

    const { canvas, context } = createRasterSurface(targetWidth, targetHeight);
    if (!context) {
      throw new Error("Failed to initialize image resize canvas.");
    }

    context.drawImage(source, 0, 0, targetWidth, targetHeight);
    const encoded = await canvasToImageBytes(canvas, resolvedMediaType);
    const nextBase64 = convertUint8ArrayToBase64(encoded.bytes);

    return {
      value: payload.preserveDataUrl
        ? `data:${encoded.mediaType};base64,${nextBase64}`
        : nextBase64,
      mediaType: encoded.mediaType,
    };
  } finally {
    releaseCanvasImageSource(source);
  }
};

const compressContentOutputParts = async (
  parts: unknown[],
  scale: number,
): Promise<{ changed: boolean; parts: unknown[] }> => {
  let changed = false;
  const nextParts: unknown[] = [];

  for (const part of parts) {
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      nextParts.push(part);
      continue;
    }

    const record = part as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "";
    if (type !== "image-data" && type !== "image") {
      nextParts.push(part);
      continue;
    }

    const valueKey = type === "image-data" ? "data" : "image";
    const sourceValue = record[valueKey];
    if (typeof sourceValue !== "string" || !sourceValue.trim()) {
      nextParts.push(part);
      continue;
    }

    try {
      const compressed = await downscaleBase64Image({
        value: sourceValue,
        mediaType:
          typeof record.mediaType === "string" ? record.mediaType : undefined,
        scale,
      });

      if (!compressed || compressed.value === sourceValue) {
        nextParts.push(part);
        continue;
      }

      changed = true;
      nextParts.push({
        ...record,
        [valueKey]: compressed.value,
        mediaType: compressed.mediaType,
      });
    } catch {
      nextParts.push(part);
    }
  }

  return { changed, parts: nextParts };
};

type VisualToolResultTarget = {
  messageIndex: number;
  partIndex: number;
  rankFromNewest: number;
};

const getVisualToolResultTargets = (messages: AiChatMessageRecord[]) => {
  const targets: VisualToolResultTarget[] = [];

  for (
    let messageIndex = 0;
    messageIndex < messages.length;
    messageIndex += 1
  ) {
    const message = messages[messageIndex];
    if (message.role !== "tool" || !Array.isArray(message.content)) continue;

    for (
      let partIndex = 0;
      partIndex < message.content.length;
      partIndex += 1
    ) {
      const part = message.content[partIndex];
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      const record = part as Record<string, unknown>;
      if (record.type !== "tool-result") continue;
      if (record.toolName !== "get_pages_visual") continue;

      const output = record.output;
      if (
        !output ||
        typeof output !== "object" ||
        Array.isArray(output) ||
        (output as { type?: unknown }).type !== "content" ||
        !Array.isArray((output as { value?: unknown }).value)
      ) {
        continue;
      }

      targets.push({
        messageIndex,
        partIndex,
        rankFromNewest: 0,
      });
    }
  }

  let rankFromNewest = 0;
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    targets[index]!.rankFromNewest = rankFromNewest;
    rankFromNewest += 1;
  }

  return targets;
};

export const compressVisualToolHistoryForModel = async (options: {
  messages: AiChatMessageRecord[];
  keepWindow: number;
}) => {
  const keepWindow = Math.max(0, Math.trunc(options.keepWindow || 0));
  const targets = getVisualToolResultTargets(options.messages);
  if (targets.length === 0) return options.messages;

  const nextMessages = [...options.messages];
  let changed = false;

  for (const target of targets) {
    const age = Math.max(0, target.rankFromNewest - keepWindow + 1);
    if (age <= 0) continue;

    const message = nextMessages[target.messageIndex];
    if (
      !message ||
      message.role !== "tool" ||
      !Array.isArray(message.content)
    ) {
      continue;
    }

    const part = message.content[target.partIndex];
    if (!part || typeof part !== "object" || Array.isArray(part)) continue;
    const record = part as Record<string, unknown>;
    const output = record.output;
    if (
      !output ||
      typeof output !== "object" ||
      Array.isArray(output) ||
      (output as { type?: unknown }).type !== "content" ||
      !Array.isArray((output as { value?: unknown }).value)
    ) {
      continue;
    }

    const scale = 0.5 ** age;
    const compressedOutput = await compressContentOutputParts(
      (output as { value: unknown[] }).value,
      scale,
    );
    if (!compressedOutput.changed) continue;

    const nextContent = [...message.content];
    nextContent[target.partIndex] = {
      ...record,
      output: {
        ...(output as Record<string, unknown>),
        value: compressedOutput.parts,
      },
    } as (typeof nextContent)[number];

    nextMessages[target.messageIndex] = {
      ...message,
      content: nextContent,
    };
    changed = true;
  }

  return changed ? nextMessages : options.messages;
};
