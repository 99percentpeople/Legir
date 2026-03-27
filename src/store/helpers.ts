import { AI_PROVIDER_IDS } from "@/services/ai/sdk/providerCatalog";
import {
  AI_CHAT_DIGEST_OUTPUT_RATIO_DENOMINATOR_OPTIONS,
  AI_CHAT_DIGEST_SOURCE_CHARS_MAX,
  AI_CHAT_DIGEST_SOURCE_CHARS_MIN,
  AI_CHAT_MAX_TOOL_ROUNDS_MAX,
  AI_CHAT_MAX_TOOL_ROUNDS_MIN,
  AI_CHAT_TOOL_HISTORY_WINDOW_MAX,
  AI_CHAT_TOOL_HISTORY_WINDOW_MIN,
  AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MAX,
  AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MIN,
  ANNOTATION_STYLES,
  DEFAULT_EDITOR_UI_STATE,
} from "@/constants";
import type {
  AppOptions,
  EditorState,
  EditorUiState,
  LLMCustomModelCapability,
  LLMCustomModelConfig,
  LLMOptions,
  PageData,
} from "@/types";

const envGeminiApiKey = (process.env.GEMINI_API_KEY || "").trim();
const envOpenAiApiKey = (process.env.OPENAI_API_KEY || "").trim();
const envOpenAiApiUrl = (process.env.OPENAI_API_URL || "").trim();

const clampDigestSourceChars = (value: unknown) => {
  const next = Math.trunc(Number(value) || 0);
  if (!Number.isFinite(next) || next <= 0) {
    return DEFAULT_EDITOR_UI_STATE.options.aiChat.digestSourceCharsPerChunk;
  }
  return Math.max(
    AI_CHAT_DIGEST_SOURCE_CHARS_MIN,
    Math.min(AI_CHAT_DIGEST_SOURCE_CHARS_MAX, next),
  );
};

const clampAiChatInteger = (
  value: unknown,
  options: {
    fallback: number;
    min: number;
    max: number;
  },
) => {
  const next = Math.trunc(Number(value) || 0);
  if (!Number.isFinite(next) || next <= 0) return options.fallback;
  return Math.max(options.min, Math.min(options.max, next));
};

const CUSTOM_MODEL_CAPABILITY_ORDER: LLMCustomModelCapability[] = [
  "text",
  "image",
  "tools",
];

const normalizeCustomModelCapability = (value: string) => {
  if (value === "text" || value === "image" || value === "tools") {
    return value;
  }
  return null;
};

const normalizeCustomModelCapabilities = (
  values: readonly string[] | undefined,
): LLMCustomModelCapability[] => {
  const seen = new Set<LLMCustomModelCapability>(["text"]);
  const normalized: LLMCustomModelCapability[] = ["text"];

  for (const value of values ?? []) {
    const capability = normalizeCustomModelCapability(value);
    if (!capability || seen.has(capability)) continue;
    seen.add(capability);
    normalized.push(capability);
  }

  return CUSTOM_MODEL_CAPABILITY_ORDER.filter((capability) =>
    normalized.includes(capability),
  );
};

const normalizeCustomModelConfigs = (
  customModels: readonly LLMCustomModelConfig[] | undefined,
): LLMCustomModelConfig[] => {
  const byId = new Map<string, Set<LLMCustomModelCapability>>();

  const upsert = (
    modelId: string,
    capabilities: readonly LLMCustomModelCapability[],
  ) => {
    const normalizedId = modelId.trim();
    if (!normalizedId) return;

    const nextCapabilities =
      byId.get(normalizedId) || new Set<LLMCustomModelCapability>();
    for (const capability of normalizeCustomModelCapabilities(capabilities)) {
      nextCapabilities.add(capability);
    }
    byId.set(normalizedId, nextCapabilities);
  };

  for (const model of customModels || []) {
    if (!model?.id) continue;
    upsert(model.id, normalizeCustomModelCapabilities(model.capabilities));
  }

  return [...byId.entries()].map(([id, capabilities]) => ({
    id,
    capabilities: normalizeCustomModelCapabilities([...capabilities]),
  }));
};

// Keep provider keys stable even when individual provider config is missing.
export const createEmptyLlmOptions = (): LLMOptions =>
  Object.fromEntries(
    AI_PROVIDER_IDS.map((providerId) => [
      providerId,
      {
        enabled: true,
        apiKey: "",
        apiUrl: "",
        customModels: [],
      },
    ]),
  ) as LLMOptions;

export const mergeLlmOptions = (
  base: LLMOptions,
  patch?: Partial<LLMOptions>,
): LLMOptions =>
  Object.fromEntries(
    AI_PROVIDER_IDS.map((providerId) => [
      providerId,
      {
        ...base[providerId],
        ...patch?.[providerId],
      },
    ]),
  ) as LLMOptions;

export const trimLlmOptions = (options: LLMOptions): LLMOptions =>
  Object.fromEntries(
    AI_PROVIDER_IDS.map((providerId) => {
      const providerOptions = options[providerId];

      return [
        providerId,
        {
          ...providerOptions,
          enabled: providerOptions.enabled !== false,
          apiKey: (providerOptions.apiKey || "").trim(),
          apiUrl: (providerOptions.apiUrl || "").trim(),
          customModels: normalizeCustomModelConfigs(
            providerOptions.customModels,
          ),
        },
      ];
    }),
  ) as LLMOptions;

export const applyEnvLlmDefaults = (options: LLMOptions): LLMOptions => ({
  ...options,
  gemini: {
    ...options.gemini,
    apiKey: (options.gemini.apiKey || envGeminiApiKey).trim(),
  },
  openai: {
    ...options.openai,
    apiKey: (options.openai.apiKey || envOpenAiApiKey).trim(),
    apiUrl: (options.openai.apiUrl || envOpenAiApiUrl).trim(),
  },
});

export const normalizeLlmOptions = (options: LLMOptions): LLMOptions =>
  applyEnvLlmDefaults(trimLlmOptions(options));

export const createEmptyLlmModelCache = (): EditorState["llmModelCache"] =>
  Object.fromEntries(
    AI_PROVIDER_IDS.map((providerId) => [
      providerId,
      {
        translateModels: [],
        visionModels: [],
      },
    ]),
  ) as EditorState["llmModelCache"];

export type PersistedLegacyAiChatOptions = Partial<AppOptions["aiChat"]> & {
  digestCharsPerChunk?: number;
  digestSummaryProviderId?: string;
  digestSummaryModelId?: string;
};

const normalizeDigestOutputRatioDenominator = (
  value: unknown,
): AppOptions["aiChat"]["digestOutputRatioDenominator"] => {
  if (
    typeof value === "number" &&
    AI_CHAT_DIGEST_OUTPUT_RATIO_DENOMINATOR_OPTIONS.includes(
      value as (typeof AI_CHAT_DIGEST_OUTPUT_RATIO_DENOMINATOR_OPTIONS)[number],
    )
  ) {
    return value as AppOptions["aiChat"]["digestOutputRatioDenominator"];
  }
  return 3;
};

const deriveLegacyDigestOutputRatioDenominator = (options: {
  digestCharsPerChunk?: number;
  digestSourceCharsPerChunk?: number;
}) => {
  const outputChars = Math.max(1, Math.trunc(options.digestCharsPerChunk || 0));
  const sourceChars = Math.max(
    outputChars,
    Math.trunc(options.digestSourceCharsPerChunk || 0),
  );
  const rawRatio = sourceChars / outputChars;
  const candidates: Array<
    AppOptions["aiChat"]["digestOutputRatioDenominator"]
  > = [...AI_CHAT_DIGEST_OUTPUT_RATIO_DENOMINATOR_OPTIONS];
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - rawRatio) < Math.abs(best - rawRatio)
      ? candidate
      : best,
  );
};

export const normalizeAiChatOptions = (
  base: AppOptions["aiChat"],
  patch?: PersistedLegacyAiChatOptions,
): AppOptions["aiChat"] => {
  const next = {
    ...base,
    ...patch,
  };

  const legacyProviderId = patch?.digestSummaryProviderId?.trim();
  const legacyModelId = patch?.digestSummaryModelId?.trim();
  if (
    (!next.digestSummaryModelKey || !next.digestSummaryModelKey.trim()) &&
    legacyProviderId &&
    legacyModelId
  ) {
    next.digestSummaryModelKey = `${legacyProviderId}:${legacyModelId}`;
  }

  return {
    digestEnabled:
      typeof next.digestEnabled === "boolean" ? next.digestEnabled : true,
    digestSourceCharsPerChunk: clampDigestSourceChars(
      next.digestSourceCharsPerChunk,
    ),
    digestOutputRatioDenominator: normalizeDigestOutputRatioDenominator(
      next.digestOutputRatioDenominator ??
        deriveLegacyDigestOutputRatioDenominator({
          digestCharsPerChunk: patch?.digestCharsPerChunk,
          digestSourceCharsPerChunk: clampDigestSourceChars(
            next.digestSourceCharsPerChunk,
          ),
        }),
    ),
    digestSummaryModelKey: next.digestSummaryModelKey || "",
    visualSummaryEnabled:
      typeof next.visualSummaryEnabled === "boolean"
        ? next.visualSummaryEnabled
        : true,
    visualSummaryModelKey: next.visualSummaryModelKey || "",
    formToolsEnabled:
      typeof next.formToolsEnabled === "boolean"
        ? next.formToolsEnabled
        : false,
    detectFormFieldsEnabled:
      typeof next.detectFormFieldsEnabled === "boolean"
        ? next.detectFormFieldsEnabled
        : false,
    formToolsVisionModelKey: next.formToolsVisionModelKey || "",
    contextPruningEnabled:
      typeof next.contextPruningEnabled === "boolean"
        ? next.contextPruningEnabled
        : true,
    toolHistoryMessageWindow: clampAiChatInteger(
      next.toolHistoryMessageWindow,
      {
        fallback:
          DEFAULT_EDITOR_UI_STATE.options.aiChat.toolHistoryMessageWindow,
        min: AI_CHAT_TOOL_HISTORY_WINDOW_MIN,
        max: AI_CHAT_TOOL_HISTORY_WINDOW_MAX,
      },
    ),
    visualToolHistoryMessageWindow: clampAiChatInteger(
      next.visualToolHistoryMessageWindow,
      {
        fallback:
          DEFAULT_EDITOR_UI_STATE.options.aiChat.visualToolHistoryMessageWindow,
        min: AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MIN,
        max: AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MAX,
      },
    ),
    maxToolRounds: clampAiChatInteger(next.maxToolRounds, {
      fallback: DEFAULT_EDITOR_UI_STATE.options.aiChat.maxToolRounds,
      min: AI_CHAT_MAX_TOOL_ROUNDS_MIN,
      max: AI_CHAT_MAX_TOOL_ROUNDS_MAX,
    }),
  };
};

export const mergeEditorOptions = (
  base: AppOptions,
  patch?: Partial<AppOptions>,
): AppOptions => {
  if (!patch) {
    return {
      ...base,
      llm: normalizeLlmOptions(base.llm),
      aiChat: normalizeAiChatOptions(base.aiChat),
    };
  }

  return {
    ...base,
    ...patch,
    ...(patch.llm
      ? {
          llm: normalizeLlmOptions(mergeLlmOptions(base.llm, patch.llm)),
        }
      : {}),
    ...(patch.snappingOptions
      ? {
          snappingOptions: {
            ...base.snappingOptions,
            ...patch.snappingOptions,
          },
        }
      : {}),
    ...(patch.debugOptions
      ? {
          debugOptions: {
            ...base.debugOptions,
            ...patch.debugOptions,
          },
        }
      : {}),
    ...(patch.aiChat
      ? {
          aiChat: normalizeAiChatOptions(base.aiChat, patch.aiChat),
        }
      : {}),
  };
};

export const normalizeEditorOptions = (options: AppOptions): AppOptions =>
  mergeEditorOptions(options);

export const revokeObjectUrlIfNeeded = (url: string | undefined | null) => {
  if (!url) return;
  if (!url.startsWith("blob:")) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // ignore
  }
};

export const revokeThumbnailObjectUrls = (
  thumbnailImages: Record<number, string>,
) => {
  for (const url of Object.values(thumbnailImages)) {
    revokeObjectUrlIfNeeded(url);
  }
};

export const revokeLegacyPageThumbnailObjectUrls = (pages: PageData[]) => {
  for (const page of pages as Array<PageData & { imageData?: string }>) {
    revokeObjectUrlIfNeeded(page.imageData);
  }
};

export function pickEditorUiState(
  state: Partial<EditorState>,
): Partial<EditorUiState> {
  return {
    isSidebarOpen: state.isSidebarOpen,
    isRightPanelOpen: state.isRightPanelOpen,
    rightPanelTab: state.rightPanelTab,
    sidebarTab: state.sidebarTab,
    pageLayout: state.pageLayout,
    pageFlow: state.pageFlow,
    sidebarWidth: state.sidebarWidth,
    rightPanelWidth: state.rightPanelWidth,
    translateOption: state.translateOption,
    translateTargetLanguage: state.translateTargetLanguage,
    pageTranslateOptions: state.pageTranslateOptions,
    options: state.options,
    rightPanelDockTab: state.rightPanelDockTab,
  };
}

export const initialState: EditorState = {
  pdfFile: null,
  pdfBytes: null,
  pdfOpenPassword: null,
  exportPassword: null,
  metadata: {},
  filename: "document.pdf",
  saveTarget: null,
  pages: [],
  thumbnailImages: {},
  fields: [],
  annotations: [],
  preservedSourceAnnotations: [],
  outline: [],
  selectedId: null,
  scale: 1.0,
  mode: "annotation",
  tool: "select",
  penStyle: {
    color: ANNOTATION_STYLES.ink.color,
    thickness: ANNOTATION_STYLES.ink.thickness,
    opacity: ANNOTATION_STYLES.ink.opacity,
  },
  highlightStyle: {
    color: ANNOTATION_STYLES.highlight.color,
    thickness: ANNOTATION_STYLES.highlight.thickness,
    opacity: ANNOTATION_STYLES.highlight.opacity,
  },
  commentStyle: {
    color: ANNOTATION_STYLES.comment.color,
    opacity: ANNOTATION_STYLES.comment.opacity,
  },
  freetextStyle: {
    color: ANNOTATION_STYLES.freetext.color,
    size: ANNOTATION_STYLES.freetext.size,
    borderColor: ANNOTATION_STYLES.freetext.borderColor,
    borderWidth: ANNOTATION_STYLES.freetext.borderWidth,
  },
  shapeStyle: {
    color: ANNOTATION_STYLES.shape.color,
    thickness: ANNOTATION_STYLES.shape.thickness,
    opacity: ANNOTATION_STYLES.shape.opacity,
    backgroundColor: ANNOTATION_STYLES.shape.backgroundColor,
    backgroundOpacity: ANNOTATION_STYLES.shape.backgroundOpacity,
    arrowSize: ANNOTATION_STYLES.shape.arrowSize,
    cloudIntensity: ANNOTATION_STYLES.shape.cloudIntensity,
    cloudSpacing: ANNOTATION_STYLES.shape.cloudSpacing,
  },
  isProcessing: false,
  past: [],
  future: [],
  clipboard: null,
  lastSavedAt: null,
  processingStatus: null,
  isPanelFloating: false,
  isSaving: false,
  pageTranslateParagraphCandidates: [],
  pageTranslateSelectedParagraphIds: [],
  ...DEFAULT_EDITOR_UI_STATE,
  isFullscreen: false,
  hasSavedSession: false,
  isDirty: false,
  currentPageIndex: 0,
  pendingViewStateRestore: null,
  fitTrigger: 0,
  keys: {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    space: false,
  },
  activeDialog: null,
  closeConfirmSource: null,
  actionSignal: null,
  llmModelCache: createEmptyLlmModelCache(),
};

initialState.options = normalizeEditorOptions({
  ...initialState.options,
  llm: mergeLlmOptions(createEmptyLlmOptions(), initialState.options.llm),
});

// Page-translate candidate merging uses median/common-value heuristics so merged
// blocks keep a visually plausible style.
export const medianNumber = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
};

export const pickMostCommonString = (values: string[]) => {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: { value: string; count: number } | null = null;
  for (const [value, count] of counts) {
    if (!best || count > best.count) {
      best = { value, count };
    }
  }
  return best?.value;
};

export const unionRect = (
  rects: Array<{ x: number; y: number; width: number; height: number }>,
) => {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
};
