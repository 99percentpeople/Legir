/** Portable PDF defaults; application UI preferences stay in the host. */

// Shared encoding for sidebar, page editor and import thumbnails. The document
// queue refreshes only changed pages and yields to workspace interactions.
export const THUMBNAIL_TARGET_WIDTH = 500;

export const THUMBNAIL_MIME_TYPE = "image/jpeg";

export const THUMBNAIL_JPEG_QUALITY = 0.7;

export const THUMBNAIL_WARMUP_PRIORITY = 10000;

export const DEFAULT_FIELD_STYLE = {
  borderColor: "#000000",
  backgroundColor: "#e6f2ff", // Light blue-ish hint by default
  borderWidth: 1,
  textColor: "#000000",
  fontSize: 12,
  fontFamily: "Helvetica",
  isTransparent: false,
};

export const FONT_FAMILY_MAP: Record<string, string> = {
  Helvetica: "Helvetica, Arial, sans-serif",
  "Times Roman": '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
  "Noto Sans SC":
    '"Noto Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  "Source Han Serif SC": '"Source Han Serif SC", "Songti SC", "STSong", serif',
};

export const CJK_FALLBACK_SANS_FONT_KEY = "Noto Sans SC";

export const CJK_FALLBACK_SERIF_FONT_KEY = "Source Han Serif SC";

export const PDF_CUSTOM_KEYS = {
  placeholder: "FFPlaceholder",
  cloudSpacing: "FFCloudSpacing",
  shapeFillOpacity: "FFShapeFillOpacity",
  arrowSize: "FFArrowSize",
  startArrowStyle: "FFStartArrowStyle",
  endArrowStyle: "FFEndArrowStyle",
  stampSourceSvgData: "FFStampSourceSvgData",
  stampImageScaleMode: "FFStampImageScaleMode",
} as const;
