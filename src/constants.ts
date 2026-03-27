import type { EditorUiState, LLMOptions, PageTranslateOptions } from "./types";
import { AI_PROVIDER_IDS } from "./services/ai/sdk/providerCatalog";

export const DEFAULT_SCALE = 1.0;
export const ZOOM_BASE = 1.25;
export const MIN_FIELD_SIZE = 10;
export const PAGE_PADDING = 24; // px

export const PDF_TEXT_SELECTION_HANDLE_WIDTH_PX = 14;
export const PDF_TEXT_SELECTION_HANDLE_DOT_SIZE_PX = 12;
export const PDF_TEXT_SELECTION_HANDLE_STEM_WIDTH_PX = 2;
export const INK_SESSION_CHUNK_IDLE_DELAY_MS = 1000;

export const MAX_PIXELS_PER_PAGE = 16_000_000;
export const TILE_MAX_DIM = 2048;
export const WORKSPACE_HEAVY_PAGE_PIXEL_THRESHOLD = 8_000_000;
export const WORKSPACE_HEAVY_PAGE_DPR_CAP = 1;

// Thumbnail warmup (generate page preview images once per document).
// Primary usage:
// - `src/store/useEditorStore.ts` -> `warmupThumbnails()` (calls `pdfWorkerService.renderPageImage`)
// - Cached value stored in `EditorState.thumbnailImages` and displayed by `src/components/sidebar/ThumbnailsPanel.tsx`
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
export const AI_CHAT_MAX_READ_PAGES_PER_CALL = 10;
export const AI_CHAT_DIGEST_MAX_PAGES_PER_LEAF_CHUNK = 16;
export const AI_CHAT_DIGEST_MERGE_BATCH_SIZE = 6;
export const AI_CHAT_DIGEST_SUMMARY_CONCURRENCY = 3;
export const AI_CHAT_DIGEST_SOURCE_CHARS_MIN = 1000;
export const AI_CHAT_DIGEST_SOURCE_CHARS_MAX = 24000;
export const AI_CHAT_DIGEST_SOURCE_CHARS_STEP = 1000;
export const AI_CHAT_DIGEST_OUTPUT_RATIO_DENOMINATOR_OPTIONS = [
  2, 3, 4, 5, 6, 7, 8, 9, 10,
] as const;
export const AI_CHAT_DIGEST_OUTPUT_CHARS_MIN = 180;
export const AI_CHAT_DIGEST_OUTPUT_CHARS_MAX = 12000;

export const DEFAULT_PAGE_TRANSLATE_UI_PREFERENCES: PageTranslateOptions = {
  fontFamily: "Helvetica",
  usePositionAwarePrompt: false,
  aiReflowParagraphs: false,
  useParagraphs: false,
  flattenFreetext: false,
  contextWindow: "none",
  paragraphXGap: 1,
  paragraphYGap: 1,
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
      disablePdfTextLayer: false,
      pdfZoomRenderTiming: false,
      workspaceZoomJank: false,
    },
    userName: "",
    thumbnailsLayout: "single",
    removeTextUnderFlattenedFreetext: true,
    llm: Object.fromEntries(
      AI_PROVIDER_IDS.map((providerId) => [
        providerId,
        {
          enabled: true,
          apiKey: "",
          apiUrl: "",
          customModels: [],
        },
      ]),
    ) as LLMOptions,
    aiChat: {
      digestEnabled: true,
      digestSourceCharsPerChunk: 12000,
      digestOutputRatioDenominator: 3,
      digestSummaryModelKey: "",
      visualSummaryEnabled: true,
      visualSummaryModelKey: "",
      formToolsEnabled: false,
      detectFormFieldsEnabled: false,
      formToolsVisionModelKey: "",
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

export const FOREGROUND_COMMON_COLORS = [
  "#000000",
  "#58595b",
  "#e61b1b",
  "#ff5500",
  "#004de6",
  "#008055",
] as const;

export const BACKGROUND_COMMON_COLORS = [
  "#ffffff",
  "#ffce00",
  "#ffc680",
  "#ff80ff",
  "#80ff9e",
  "#80d6ff",
] as const;

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
    borderColor: "#000000",
    borderWidth: 1,
  },
  shape: {
    color: "#e61b1b",
    thickness: 2,
    opacity: 1.0,
    backgroundColor: undefined,
    backgroundOpacity: 1.0,
    arrowSize: 10,
    cloudIntensity: 2,
    cloudSpacing: 28,
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
export const AI_CHAT_MAX_PAGE_IMAGES_PER_CALL = 4;
export const AI_CHAT_PAGE_IMAGE_PIXEL_DENSITY = 2.5;

export const PDF_CUSTOM_KEYS = {
  placeholder: "FFPlaceholder",
  shapeSubType: "FFShapeSubType",
  cloudIntensity: "FFCloudIntensity",
  cloudSpacing: "FFCloudSpacing",
  shapeFillOpacity: "FFShapeFillOpacity",
  arrowSize: "FFArrowSize",
  startArrowStyle: "FFStartArrowStyle",
  endArrowStyle: "FFEndArrowStyle",
  shapeStrokeColor: "FFShapeStrokeColor",
  shapeStrokeWidth: "FFShapeStrokeWidth",
} as const;
