import type { EditorUiState } from "./types";

export const DEFAULT_SCALE = 1.0;
export const ZOOM_BASE = 1.25;
export const MIN_FIELD_SIZE = 10;
export const PAGE_PADDING = 24; // px

export const DEFAULT_EDITOR_UI_STATE: EditorUiState = {
  isSidebarOpen: !(typeof window !== "undefined" && window.innerWidth < 768),
  isRightPanelOpen: !(typeof window !== "undefined" && window.innerWidth < 768),
  rightPanelTab: "document",
  sidebarTab: "thumbnails",
  sidebarWidth: 256,
  rightPanelWidth: 320,
};

export const COLORS = {
  primary: "blue-600",
  fieldBorder: "#3b82f6",
  fieldBg: "rgba(59, 130, 246, 0.15)",
  fieldSelectedBorder: "#2563eb",
  fieldSelectedBg: "rgba(37, 99, 235, 0.3)",
};

// prettier-ignore
export const PEN_COLORS = [
  // Row 1
  "#000000", "#58595b", "#808285", "#a7a9ac", "#d1d3d4", "#ffffff",
  // Row 2
  "#b31564", "#e61b1b", "#ff5500", "#ffaa00", "#ffce00", "#ffe600",
  // Row 3
  "#a2e61b", "#26e600", "#008055", "#008055", "#004de6", "#3d00b8",
  // Row 4
  "#6600cc", "#600080", "#f7d7c4", "#bb9167", "#8e562e", "#613d30",
  // Row 5
  "#ff80ff", "#ffc680", "#ffff80", "#80ff9e", "#80d6ff", "#bcb3ff",
];

export const DEFAULT_FIELD_STYLE = {
  borderColor: "#000000",
  backgroundColor: "#e6f2ff", // Light blue-ish hint by default
  borderWidth: 1,
  textColor: "#000000",
  fontSize: 12,
  fontFamily: "Helvetica",
  isTransparent: false,
};

export const ANNOTATION_STYLES = {
  highlight: {
    color: "#ffce00", // Yellow
    thickness: 12,
    opacity: 0.4,
  },
  ink: {
    color: "#e61b1b", // Red
    thickness: 2,
    opacity: 1.0,
  },
  comment: {
    color: "#ffaa00", // Orange
    opacity: 1.0,
  },
  freetext: {
    color: "#000000",
    size: 12,
  },
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
