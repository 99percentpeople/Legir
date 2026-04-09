import type {
  StampAppearanceSource,
  StampImageAppearance,
  StampImageFrame,
  StampImageResource,
  StampNormalizedBox,
} from "@/types";

export interface StampImageAsset {
  dataUrl: string;
  width: number;
  height: number;
  name: string;
}

export const createStampImageResource = (options: {
  dataUrl?: string;
  width?: number;
  height?: number;
}): StampImageResource | undefined => {
  if (!options.dataUrl) return undefined;

  const intrinsicSize =
    typeof options.width === "number" &&
    Number.isFinite(options.width) &&
    options.width > 0 &&
    typeof options.height === "number" &&
    Number.isFinite(options.height) &&
    options.height > 0
      ? {
          width: options.width,
          height: options.height,
        }
      : undefined;

  return {
    dataUrl: options.dataUrl,
    intrinsicSize,
  };
};

export const createStampImageAppearance = (options?: {
  frame?: StampImageFrame;
  box?: StampNormalizedBox;
  source?: StampAppearanceSource;
}): StampImageAppearance | undefined => {
  if (!options?.frame && !options?.box && !options?.source) return undefined;

  return {
    frame: options?.frame,
    box: options?.box,
    source: options?.source,
  };
};

const DEFAULT_STAMP_DOWNLOAD_EXTENSION = "png";

const getStampImageMimeType = (dataUrl: string) => {
  const match = dataUrl.match(/^data:([^;,]+)[;,]/i);
  return match?.[1]?.trim().toLowerCase() || "image/png";
};

const parseStampImageDataUrl = (dataUrl: string) => {
  if (!dataUrl.startsWith("data:")) {
    throw new Error("Invalid stamp image data.");
  }

  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    throw new Error("Invalid stamp image data.");
  }

  const metadata = dataUrl.slice(5, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  const parts = metadata
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const mimeType = (parts[0] || "image/png").toLowerCase();
  const isBase64 = parts
    .slice(1)
    .some((part) => part.toLowerCase() === "base64");

  return {
    mimeType,
    isBase64,
    payload,
  };
};

export const getStampImageExtension = (dataUrl: string) => {
  const mimeType = getStampImageMimeType(dataUrl);
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/jp2" || mimeType === "image/jpeg2000") return "jp2";
  if (mimeType === "image/svg+xml") return "svg";
  return DEFAULT_STAMP_DOWNLOAD_EXTENSION;
};

export const decodeStampImageDataUrl = (dataUrl: string) => {
  const { mimeType, isBase64, payload } = parseStampImageDataUrl(dataUrl);

  if (isBase64) {
    if (typeof atob !== "function") {
      throw new Error("Base64 decoding is unavailable in this environment.");
    }
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return { bytes, mimeType };
  }

  let decoded = payload;
  try {
    decoded = decodeURIComponent(payload);
  } catch {
    decoded = payload;
  }
  const bytes = new TextEncoder().encode(decoded);
  return { bytes, mimeType };
};

const parseSvgLength = (value: string | null | undefined) => {
  if (!value) return undefined;
  const match = value
    .trim()
    .match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/);
  if (!match) return undefined;
  const next = Number.parseFloat(match[1]);
  return Number.isFinite(next) && next > 0 ? next : undefined;
};

export const getStampSvgIntrinsicSize = (dataUrl: string) => {
  const { bytes, mimeType } = decodeStampImageDataUrl(dataUrl);
  if (mimeType !== "image/svg+xml") return undefined;

  let svgText = "";
  try {
    svgText = new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }

  const widthAttr = svgText.match(/\bwidth=["']([^"']+)["']/i)?.[1];
  const heightAttr = svgText.match(/\bheight=["']([^"']+)["']/i)?.[1];
  const width = parseSvgLength(widthAttr);
  const height = parseSvgLength(heightAttr);

  if (width && height) {
    return { width, height };
  }

  const viewBoxAttr = svgText.match(/\bviewBox=["']([^"']+)["']/i)?.[1];
  if (!viewBoxAttr) return undefined;

  const values = viewBoxAttr
    .trim()
    .split(/[\s,]+/)
    .map((token) => Number.parseFloat(token))
    .filter((token) => Number.isFinite(token));
  if (values.length < 4) return undefined;

  const viewBoxWidth = values[2];
  const viewBoxHeight = values[3];
  if (!(viewBoxWidth > 0 && viewBoxHeight > 0)) return undefined;

  return {
    width: viewBoxWidth,
    height: viewBoxHeight,
  };
};

export const getSuggestedStampImageFilename = (
  stampId: string,
  dataUrl: string,
) => {
  const extension = getStampImageExtension(dataUrl);
  const safeId = stampId.trim() || "stamp-image";
  return `${safeId}.${extension}`;
};

export const loadStampImageFile = (file: File): Promise<StampImageAsset> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error("Failed to read stamp image."));
    };

    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Invalid stamp image data."));
        return;
      }

      const image = new Image();
      image.onerror = () => {
        reject(new Error("Failed to decode stamp image."));
      };
      image.onload = () => {
        resolve({
          dataUrl: result,
          width: image.naturalWidth,
          height: image.naturalHeight,
          name: file.name,
        });
      };
      image.src = result;
    };

    reader.readAsDataURL(file);
  });
