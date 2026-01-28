import type { EditorUiState, PageTranslateOptions } from "./types";

export const DEFAULT_SCALE = 1.0;
export const ZOOM_BASE = 1.25;
export const MIN_FIELD_SIZE = 10;
export const PAGE_PADDING = 24; // px

export const PDF_TEXT_SELECTION_HANDLE_WIDTH_PX = 14;
export const PDF_TEXT_SELECTION_HANDLE_DOT_SIZE_PX = 12;
export const PDF_TEXT_SELECTION_HANDLE_STEM_WIDTH_PX = 2;

export const MAX_PIXELS_PER_PAGE = 16_000_000;
export const TILE_MAX_DIM = 2048;

// Thumbnail warmup (generate page preview images once per document).
// Primary usage:
// - `src/store/useEditorStore.ts` -> `warmupThumbnails()` (calls `pdfWorkerService.renderPageImage`)
// - Cached value stored in `PageData.imageData` and displayed by `src/components/sidebar/ThumbnailsPanel.tsx`
export const THUMBNAIL_TARGET_WIDTH = 500;
export const THUMBNAIL_MIME_TYPE = "image/jpeg";
export const THUMBNAIL_JPEG_QUALITY = 0.7;
export const THUMBNAIL_WARMUP_PRIORITY = 10000;

export const FIT_WIDTH_PADDING_X = 96;
export const FIT_SCREEN_PADDING_X = 96;
export const FIT_SCREEN_PADDING_Y = 120;

export const WORKSPACE_BASE_PADDING_PX = 32;
export const WORKSPACE_BASE_PAGE_GAP_PX = 32;
export const WORKSPACE_BOTTOM_PADDING_PX = 80;
export const WORKSPACE_VIRTUALIZATION_THRESHOLD_PAGES = 30;
export const WORKSPACE_VIRTUALIZATION_OVERSCAN_PAGES = 5;

export const DEFAULT_PAGE_TRANSLATE_UI_PREFERENCES: PageTranslateOptions = {
  fontFamily: "Helvetica",
  usePositionAwarePrompt: false,
  aiReflowParagraphs: false,
  useParagraphs: false,
  flattenFreetext: false,
  contextWindow: "none",
  paragraphXGap: 2.5,
  paragraphYGap: 1.2,
  paragraphSplitByFontSize: false,
  freetextPadding: 1,
};

export const DEFAULT_EDITOR_UI_STATE: EditorUiState = {
  isSidebarOpen: !(typeof window !== "undefined" && window.innerWidth < 768),
  isRightPanelOpen: false,
  rightPanelTab: "document",
  rightPanelDockTab: [],
  sidebarTab: "thumbnails",
  pageLayout: "single",
  pageFlow: "vertical",
  sidebarWidth: 256,
  rightPanelWidth: 320,
  translateOption: "cloud:cloudv2",
  translateTargetLanguage: null,
  pageTranslateOptions: DEFAULT_PAGE_TRANSLATE_UI_PREFERENCES,
  options: {
    snappingOptions: {
      enabled: true,
      snapToBorders: true,
      snapToCenter: true,
      snapToEqualDistances: false,
      threshold: 8,
    },
    debugOptions: {
      pdfTextLayer: false,
    },
    userName: "",
    thumbnailsLayout: "single",
    llm: {
      openai: {
        customTranslateModels: [],
        customVisionModels: [],
      },
      gemini: {
        customTranslateModels: [],
        customVisionModels: [],
      },
    },
  },
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

export const LEFT_SIDEBAR_MIN_WIDTH_PX = 200;
export const LEFT_SIDEBAR_MAX_WIDTH_PX = 600;

export const RIGHT_PANEL_MIN_WIDTH_PX = 240;
export const RIGHT_PANEL_MAX_WIDTH_PX = 600;
