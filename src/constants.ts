export {
  DEFAULT_FIELD_STYLE,
  FONT_FAMILY_MAP,
  CJK_FALLBACK_SANS_FONT_KEY,
  CJK_FALLBACK_SERIF_FONT_KEY,
  PDF_CUSTOM_KEYS,
  THUMBNAIL_TARGET_WIDTH,
  THUMBNAIL_MIME_TYPE,
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_WARMUP_PRIORITY,
} from "@legir/pdf-model/constants";
import type { EditorUiState, PageTranslateOptions } from "./types";
import { pdfViewerScaleToWorkspaceScale } from "@legir/pdf-model/pdfScale";
import { DEFAULT_IMAGE_COMPRESSION } from "@legir/pdf-model/imageCompression";

export const DEFAULT_SCALE = pdfViewerScaleToWorkspaceScale(1);
export const MIN_EDITOR_SCALE = pdfViewerScaleToWorkspaceScale(0.25);
export const MAX_EDITOR_SCALE = pdfViewerScaleToWorkspaceScale(5);
export const ZOOM_BASE = 1.25;
export const MIN_PAGE_THUMBNAIL_SCALE = 0.5;
export const MAX_PAGE_THUMBNAIL_SCALE = 2;
/** Minimum width/height for interactive form-field editing, in PDF points. */
export const MIN_FIELD_SIZE = 1;
export const PAGE_PADDING = 24; // px

export const PDF_TEXT_SELECTION_HANDLE_WIDTH_PX = 14;
export const PDF_TEXT_SELECTION_HANDLE_DOT_SIZE_PX = 12;
export const PDF_TEXT_SELECTION_HANDLE_STEM_WIDTH_PX = 2;
export const INK_SESSION_CHUNK_IDLE_DELAY_MS = 1000;

export const MAX_PIXELS_PER_PAGE = 16_000_000;
export const TILE_MAX_DIM = 2048;
export const WORKSPACE_HEAVY_PAGE_PIXEL_THRESHOLD = 8_000_000;
export const WORKSPACE_HEAVY_PAGE_DPR_CAP = 1;

export const FIT_WIDTH_PADDING_X = 96;
export const FIT_SCREEN_PADDING_X = 96;
export const FIT_SCREEN_PADDING_Y = 120;

export const WORKSPACE_BASE_PADDING_PX = 32;
export const WORKSPACE_BASE_PAGE_GAP_PX = 24;
export const WORKSPACE_BOTTOM_PADDING_PX = 80;
export const WORKSPACE_VIRTUALIZATION_THRESHOLD_PAGES = 30;
export const WORKSPACE_VIRTUALIZATION_OVERSCAN_PAGES = 5;
export const AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_DEFAULT = 50_000;
export const AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MIN = 10_000;
export const AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MAX = 100_000;
export const AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_STEP = 1_000;
export const AI_CHAT_MAX_TOOL_ROUNDS_MIN = 1;
export const AI_CHAT_MAX_TOOL_ROUNDS_MAX = 50;
export const AI_CHAT_MODEL_AUTO_KEY = "auto";
export const AI_CHAT_VISUAL_MODEL_AUTO_KEY = AI_CHAT_MODEL_AUTO_KEY;
export const AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MIN = 1;
export const AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MAX = 8;
export const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 128_000;
export const AI_CHAT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT_MIN = 50;
export const AI_CHAT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT_MAX = 95;
export const AI_CHAT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT_STEP = 5;
export const AI_CHAT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT_DEFAULT = 80;
export const DEV_API_PROXY_URL = "/__legir_dev_proxy?url={url}";

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
      ignorePdfPermissions: false,
    },
    userName: "",
    thumbnailsLayout: "single",
    removeTextUnderFlattenedFreetext: true,
    imageCompression: { ...DEFAULT_IMAGE_COMPRESSION },
    apiProxy: {
      tauriForwardEnabled: false,
      proxyUrlEnabled: false,
      proxyUrl: import.meta.env.DEV ? DEV_API_PROXY_URL : "",
    },
    translation: {
      aiEnabled: true,
      googleCloud: {
        apiKey: "",
      },
    },
    llm: {},
    aiChat: {
      visualModelKey: AI_CHAT_VISUAL_MODEL_AUTO_KEY,
      formToolsEnabled: false,
      contextCompressionEnabled: true,
      contextCompressionThresholdPercent:
        AI_CHAT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT_DEFAULT,
      visualHistoryWindow: 1,
      maxToolRounds: 30,
      getPagesTextMaxChars: AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_DEFAULT,
      contextCompressionMode: "ai",
      contextCompressionModelKey: "",
      reasoning: {
        level: "auto",
        displayPolicy: "summary",
      },
    },
  },
};
export const AI_CHAT_CONVERSATION_SUMMARY_MAX_SOURCE_CHARS = 18_000;
export const AI_CHAT_CONVERSATION_SUMMARY_MAX_CHARS = 2_400;

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
    borderStyle: "solid" as const,
    dashDensity: 1,
    backgroundColor: undefined,
    backgroundOpacity: 1.0,
    arrowSize: 10,
    cloudIntensity: 2,
    cloudSpacing: 28,
  },
  stamp: {
    kind: "preset" as const,
    presetId: "approved" as const,
    image: undefined,
    imageAppearance: undefined,
    opacity: 0.9,
  },
};

export const LEFT_SIDEBAR_MIN_WIDTH_PX = 200;
export const LEFT_SIDEBAR_MAX_WIDTH_PX = 600;

export const RIGHT_PANEL_MIN_WIDTH_PX = 240;
export const RIGHT_PANEL_MAX_WIDTH_PX = 600;
export const AI_CHAT_MAX_PAGE_IMAGES_PER_CALL = 2;
export const AI_CHAT_PAGE_IMAGE_PIXEL_DENSITY = 1.5;
// App budgets, independent of provider/model names. Bound allocations before
// rendering as well as the images accumulated in a model request.
export const AI_CHAT_PAGE_IMAGE_MAX_DIMENSION = 2048;
export const AI_CHAT_PAGE_IMAGE_MAX_PIXELS = 2_000_000;
export const AI_CHAT_PAGE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const AI_CHAT_MAX_PAGE_IMAGES_PER_REQUEST = 4;
