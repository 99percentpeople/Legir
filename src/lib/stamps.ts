export type StampKind = "preset" | "image";

export type StampPresetId =
  | "approved"
  | "rejected"
  | "draft"
  | "confidential"
  | "final";

export interface StampPreset {
  id: StampPresetId;
  labelKey: string;
  fallbackLabel: string;
  color: string;
  fillColor: string;
  pdfName: string;
}

export const DEFAULT_STAMP_PRESET_ID: StampPresetId = "approved";
export const DEFAULT_STAMP_KIND: StampKind = "preset";
export const DEFAULT_STAMP_WIDTH = 140;
export const DEFAULT_STAMP_HEIGHT = 56;
export const DEFAULT_STAMP_OPACITY = 0.9;

export const STAMP_PRESETS: readonly StampPreset[] = [
  {
    id: "approved",
    labelKey: "stamp.preset.approved",
    fallbackLabel: "APPROVED",
    color: "#15803d",
    fillColor: "#dcfce7",
    pdfName: "Approved",
  },
  {
    id: "rejected",
    labelKey: "stamp.preset.rejected",
    fallbackLabel: "REJECTED",
    color: "#b91c1c",
    fillColor: "#fee2e2",
    pdfName: "Rejected",
  },
  {
    id: "draft",
    labelKey: "stamp.preset.draft",
    fallbackLabel: "DRAFT",
    color: "#b45309",
    fillColor: "#fef3c7",
    pdfName: "Draft",
  },
  {
    id: "confidential",
    labelKey: "stamp.preset.confidential",
    fallbackLabel: "CONFIDENTIAL",
    color: "#991b1b",
    fillColor: "#fee2e2",
    pdfName: "Confidential",
  },
  {
    id: "final",
    labelKey: "stamp.preset.final",
    fallbackLabel: "FINAL",
    color: "#1d4ed8",
    fillColor: "#dbeafe",
    pdfName: "Final",
  },
] as const;

const STAMP_PRESET_MAP = new Map(
  STAMP_PRESETS.map((preset) => [preset.id, preset] as const),
);

const normalizeStampToken = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, "")
    .replace(/[^A-Z]/g, "");

const STAMP_PRESET_ALIASES = new Map<string, StampPresetId>([
  ["APPROVED", "approved"],
  ["REJECTED", "rejected"],
  ["DRAFT", "draft"],
  ["CONFIDENTIAL", "confidential"],
  ["FINAL", "final"],
]);

export const shouldUseStampNameAsLabel = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (Array.from(trimmed).some((char) => char.charCodeAt(0) > 0x7f)) {
    return true;
  }
  if (/\s/.test(trimmed)) return true;
  if (/^board\.image\.\d+$/i.test(trimmed)) return false;
  if (/^board\.(?:stamp|vector)\./i.test(trimmed)) return false;
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      trimmed,
    )
  ) {
    return false;
  }
  if (/^[a-z0-9_.-]+$/i.test(trimmed) && /\.\d{3,}$/i.test(trimmed)) {
    return false;
  }
  if (/^[A-Z][A-Z0-9/&._-]{1,31}$/.test(trimmed)) return true;
  if (/^[A-Z][a-z]+$/.test(trimmed)) return true;
  const hasDigit = /\d/.test(trimmed);
  const hasLower = /[a-z]/.test(trimmed);
  const hasUpper = /[A-Z]/.test(trimmed);
  if (
    !/\s/.test(trimmed) &&
    trimmed.length >= 10 &&
    ((hasDigit && (hasLower || hasUpper)) || (hasLower && hasUpper))
  ) {
    return false;
  }
  if (/^[A-Za-z0-9_-]{12,}$/.test(trimmed)) return false;
  return true;
};

export const resolveReadableStampLabel = (options: {
  name?: string | null;
  contents?: string | null;
}) => {
  const contents = (options.contents || "").trim();
  if (shouldUseStampNameAsLabel(contents)) return contents;

  const name = (options.name || "").trim();
  if (shouldUseStampNameAsLabel(name)) return name;

  return undefined;
};

export const isStampPresetId = (value: unknown): value is StampPresetId =>
  typeof value === "string" && STAMP_PRESET_MAP.has(value as StampPresetId);

export const isStampKind = (value: unknown): value is StampKind =>
  value === "preset" || value === "image";

export const getStampPreset = (
  presetId: StampPresetId | undefined,
): StampPreset | undefined =>
  presetId ? STAMP_PRESET_MAP.get(presetId) : undefined;

export const normalizeStampKind = (
  value: unknown,
  fallback: StampKind = DEFAULT_STAMP_KIND,
): StampKind => (isStampKind(value) ? value : fallback);

export const normalizeStampOpacity = (
  value: unknown,
  fallback = DEFAULT_STAMP_OPACITY,
) => {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(0.05, Math.min(1, next));
};

const isPositiveFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export const resolveStampLabel = (options: {
  presetId?: StampPresetId;
  label?: string | null;
}) => {
  const explicit = (options.label || "").trim();
  if (explicit) return explicit;
  return (
    getStampPreset(options.presetId)?.fallbackLabel ??
    getStampPreset(DEFAULT_STAMP_PRESET_ID)?.fallbackLabel ??
    "STAMP"
  );
};

export const getReadableStampLabel = (options?: {
  kind?: StampKind;
  presetId?: StampPresetId;
  label?: string | null;
}) => {
  const explicit = (options?.label || "").trim();
  if (explicit) return explicit;
  if (options?.kind === "preset") {
    return resolveStampLabel({
      presetId: options.presetId,
      label: options.label,
    });
  }
  return undefined;
};

const getPresetStampCharWidthUnits = (char: string) => {
  if (char === " ") return 0.35;
  if ("WM".includes(char)) return 0.92;
  if ("I1".includes(char)) return 0.38;
  if ("JLTF".includes(char)) return 0.5;
  if ("ADGHNOQUVXY028".includes(char)) return 0.72;
  if ("BCEKPRSZ3569".includes(char)) return 0.66;
  if ("-_/&".includes(char)) return 0.52;
  return 0.6;
};

export const getPresetStampDimensions = (options?: {
  presetId?: StampPresetId;
  label?: string | null;
}) => {
  const label = resolveStampLabel(options ?? {});
  const fontSize = Math.max(12, DEFAULT_STAMP_HEIGHT * 0.34);
  const textUnits = Array.from(label).reduce(
    (sum, char) => sum + getPresetStampCharWidthUnits(char),
    0,
  );
  const estimatedTextWidth = textUnits * fontSize;
  const horizontalPadding = DEFAULT_STAMP_HEIGHT * 0.85;
  const width = Math.max(
    DEFAULT_STAMP_WIDTH,
    Math.ceil((estimatedTextWidth + horizontalPadding) / 4) * 4,
  );

  return {
    width,
    height: DEFAULT_STAMP_HEIGHT,
  };
};

const escapeSvgText = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const presetStampSvgDataUrlCache = new Map<string, string>();

export const getPresetStampSvgMarkup = (options: {
  presetId?: StampPresetId;
  label?: string | null;
}) => {
  const { width, height } = getPresetStampDimensions(options);
  const preset = getStampPreset(options.presetId);
  const strokeColor = preset?.color ?? "#b91c1c";
  const fillColor = preset?.fillColor ?? "#fee2e2";
  const resolvedLabel = resolveStampLabel({
    presetId: options.presetId,
    label: options.label,
  });
  const escapedLabel = escapeSvgText(resolvedLabel);
  const fontSize = Math.max(
    12,
    Math.min(height * 0.34, width / Math.max(5, resolvedLabel.length * 0.58)),
  );
  const textBaselineY = height / 2 + fontSize * 0.34;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`,
    `<rect x="1" y="1" width="${Math.max(1, width - 2)}" height="${Math.max(1, height - 2)}" rx="4" ry="4" fill="${fillColor}" fill-opacity="0.5" stroke="${strokeColor}" stroke-width="2" />`,
    `<rect x="${width * 0.07}" y="${height * 0.12}" width="${width * 0.86}" height="${height * 0.76}" rx="3" ry="3" fill="none" stroke="${strokeColor}" stroke-width="1" />`,
    `<text x="${width / 2}" y="${textBaselineY}" text-anchor="middle" fill="${strokeColor}" font-family="Helvetica" font-weight="bold" font-size="${fontSize}">${escapedLabel}</text>`,
    "</svg>",
  ].join("");
};

export const getPresetStampSvgDataUrl = (options: {
  presetId?: StampPresetId;
  label?: string | null;
}) => {
  const cacheKey = `${options.presetId ?? ""}::${resolveStampLabel({
    presetId: options.presetId,
    label: options.label,
  })}`;
  const cached = presetStampSvgDataUrlCache.get(cacheKey);
  if (cached) return cached;

  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    getPresetStampSvgMarkup(options),
  )}`;
  presetStampSvgDataUrlCache.set(cacheKey, dataUrl);
  return dataUrl;
};

export const resolveStampPresetIdFromText = (
  ...candidates: Array<string | undefined | null>
): StampPresetId | undefined => {
  for (const candidate of candidates) {
    const normalized = normalizeStampToken(candidate || "");
    if (!normalized) continue;
    const presetId = STAMP_PRESET_ALIASES.get(normalized);
    if (presetId) return presetId;
  }
  return undefined;
};

export const getStampPdfName = (
  presetId: StampPresetId | undefined,
  fallback = "Stamp",
) => getStampPreset(presetId)?.pdfName ?? fallback;

export const getStampAspectRatio = (options?: {
  rectWidth?: number;
  rectHeight?: number;
  imageWidth?: number;
  imageHeight?: number;
}) => {
  if (
    isPositiveFiniteNumber(options?.imageWidth) &&
    isPositiveFiniteNumber(options?.imageHeight)
  ) {
    return options.imageWidth / options.imageHeight;
  }

  if (
    isPositiveFiniteNumber(options?.rectWidth) &&
    isPositiveFiniteNumber(options?.rectHeight)
  ) {
    return options.rectWidth / options.rectHeight;
  }

  return undefined;
};

export const getDefaultStampDimensions = (options?: {
  kind?: StampKind;
  presetId?: StampPresetId;
  label?: string | null;
  imageWidth?: number;
  imageHeight?: number;
}) => {
  if (options?.kind !== "image") {
    return getPresetStampDimensions({
      presetId: options?.presetId,
      label: options?.label,
    });
  }

  if (
    options?.kind === "image" &&
    typeof options.imageWidth === "number" &&
    Number.isFinite(options.imageWidth) &&
    options.imageWidth > 0 &&
    typeof options.imageHeight === "number" &&
    Number.isFinite(options.imageHeight) &&
    options.imageHeight > 0
  ) {
    return {
      width: Math.max(1, Math.round(options.imageWidth)),
      height: Math.max(1, Math.round(options.imageHeight)),
    };
  }

  return {
    width: DEFAULT_STAMP_WIDTH,
    height: DEFAULT_STAMP_HEIGHT,
  };
};

export const getStampRectAtPoint = (
  point: { x: number; y: number },
  options?: {
    kind?: StampKind;
    presetId?: StampPresetId;
    label?: string | null;
    imageWidth?: number;
    imageHeight?: number;
  },
) => {
  const size = getDefaultStampDimensions(options);
  return {
    x: point.x - size.width / 2,
    y: point.y - size.height / 2,
    width: size.width,
    height: size.height,
  };
};

export const fitStampImageToRect = (
  rect: { width: number; height: number },
  image: { width: number; height: number } | undefined,
) => {
  const boxWidth = Math.max(1, rect.width);
  const boxHeight = Math.max(1, rect.height);

  if (
    !image ||
    !Number.isFinite(image.width) ||
    !Number.isFinite(image.height) ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    return {
      width: boxWidth,
      height: boxHeight,
      x: 0,
      y: 0,
    };
  }

  const scale = Math.min(boxWidth / image.width, boxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;

  return {
    width,
    height,
    x: (boxWidth - width) / 2,
    y: (boxHeight - height) / 2,
  };
};

export const restoreStampRectAspectRatio = (
  rect: { x: number; y: number; width: number; height: number },
  image: { width: number; height: number } | undefined,
) => {
  const aspectRatio = getStampAspectRatio({
    imageWidth: image?.width,
    imageHeight: image?.height,
  });

  if (
    !isPositiveFiniteNumber(aspectRatio) ||
    !isPositiveFiniteNumber(rect.width) ||
    !isPositiveFiniteNumber(rect.height)
  ) {
    return rect;
  }

  const widthLockedHeight = rect.width / aspectRatio;
  const heightLockedWidth = rect.height * aspectRatio;

  const keepWidthDelta = Math.abs(widthLockedHeight - rect.height);
  const keepHeightDelta = Math.abs(heightLockedWidth - rect.width);
  const nextWidth =
    keepHeightDelta < keepWidthDelta ? heightLockedWidth : rect.width;
  const nextHeight =
    keepHeightDelta < keepWidthDelta ? rect.height : widthLockedHeight;
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  return {
    x: centerX - nextWidth / 2,
    y: centerY - nextHeight / 2,
    width: nextWidth,
    height: nextHeight,
  };
};

export const hexToRgbaString = (hex: string, alpha: number) => {
  const normalized = hex.replace("#", "").trim();
  if (!(normalized.length === 3 || normalized.length === 6)) {
    return `rgba(0, 0, 0, ${alpha})`;
  }

  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalized;

  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};
