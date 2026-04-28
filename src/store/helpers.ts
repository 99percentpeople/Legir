import {
  AI_PROVIDER_IDS,
  getAiProviderDefaultApiOptionId,
  getAiProviderSelectedApiOption,
  type AiProviderId,
  normalizeReasoningPreference,
} from "@/services/ai/providers";
import {
  AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_MAX,
  AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_MIN,
  AI_CHAT_DIGEST_OUTPUT_RATIO_DENOMINATOR_OPTIONS,
  AI_CHAT_DIGEST_SOURCE_CHARS_MAX,
  AI_CHAT_DIGEST_SOURCE_CHARS_MIN,
  AI_CHAT_MAX_TOOL_ROUNDS_MAX,
  AI_CHAT_MAX_TOOL_ROUNDS_MIN,
  AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MAX,
  AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MIN,
  ANNOTATION_STYLES,
  DEFAULT_EDITOR_UI_STATE,
} from "@/constants";
import type {
  AppOptions,
  EditorState,
  EditorUiState,
  ApiProxyOptions,
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
  AI_PROVIDER_IDS.reduce<LLMOptions>((acc, providerId) => {
    acc[providerId as AiProviderId] = {
      enabled: true,
      apiKey: "",
      apiUrl: "",
      apiOptionId: getAiProviderDefaultApiOptionId(providerId),
      customModels: [],
    };
    return acc;
  }, {} as LLMOptions);

export const mergeLlmOptions = (
  base: LLMOptions,
  patch?: Partial<LLMOptions>,
): LLMOptions =>
  AI_PROVIDER_IDS.reduce<LLMOptions>((acc, providerId) => {
    acc[providerId as AiProviderId] = {
      ...base[providerId],
      ...patch?.[providerId],
    };
    return acc;
  }, {} as LLMOptions);

export const trimLlmOptions = (options: LLMOptions): LLMOptions =>
  AI_PROVIDER_IDS.reduce<LLMOptions>((acc, providerId) => {
    const providerOptions = options[providerId];
    const apiOption = getAiProviderSelectedApiOption(
      providerId,
      providerOptions.apiOptionId,
    );

    acc[providerId as AiProviderId] = {
      ...providerOptions,
      enabled: providerOptions.enabled !== false,
      apiKey: (providerOptions.apiKey || "").trim(),
      apiUrl: (providerOptions.apiUrl || "").trim(),
      apiOptionId:
        apiOption?.id || getAiProviderDefaultApiOptionId(providerId) || "",
      customModels: normalizeCustomModelConfigs(providerOptions.customModels),
    };
    return acc;
  }, {} as LLMOptions);

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
  AI_PROVIDER_IDS.reduce<EditorState["llmModelCache"]>(
    (acc, providerId) => {
      acc[providerId as AiProviderId] = {
        translateModels: [],
        visionModels: [],
      };
      return acc;
    },
    {} as EditorState["llmModelCache"],
  );

export type PersistedAiChatOptions = Partial<AppOptions["aiChat"]>;

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

export const normalizeAiChatOptions = (
  base: AppOptions["aiChat"],
  patch?: PersistedAiChatOptions,
): AppOptions["aiChat"] => {
  const next = {
    ...base,
    ...patch,
  };

  return {
    digestEnabled:
      typeof next.digestEnabled === "boolean" ? next.digestEnabled : true,
    digestSourceCharsPerChunk: clampDigestSourceChars(
      next.digestSourceCharsPerChunk,
    ),
    digestOutputRatioDenominator: normalizeDigestOutputRatioDenominator(
      next.digestOutputRatioDenominator,
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
    contextCompressionEnabled:
      typeof next.contextCompressionEnabled === "boolean"
        ? next.contextCompressionEnabled
        : true,
    contextCompressionThresholdTokens: clampAiChatInteger(
      next.contextCompressionThresholdTokens,
      {
        fallback:
          DEFAULT_EDITOR_UI_STATE.options.aiChat
            .contextCompressionThresholdTokens,
        min: AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_MIN,
        max: AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_MAX,
      },
    ),
    visualHistoryWindow: clampAiChatInteger(next.visualHistoryWindow, {
      fallback: DEFAULT_EDITOR_UI_STATE.options.aiChat.visualHistoryWindow,
      min: AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MIN,
      max: AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MAX,
    }),
    maxToolRounds: clampAiChatInteger(next.maxToolRounds, {
      fallback: DEFAULT_EDITOR_UI_STATE.options.aiChat.maxToolRounds,
      min: AI_CHAT_MAX_TOOL_ROUNDS_MIN,
      max: AI_CHAT_MAX_TOOL_ROUNDS_MAX,
    }),
    contextCompressionMode:
      next.contextCompressionMode === "algorithmic" ||
      next.contextCompressionMode === "ai"
        ? next.contextCompressionMode
        : DEFAULT_EDITOR_UI_STATE.options.aiChat.contextCompressionMode,
    contextCompressionModelKey: next.contextCompressionModelKey || "",
    reasoning: normalizeReasoningPreference(next.reasoning),
  };
};

const normalizeApiProxyOptions = (
  base: ApiProxyOptions,
  patch?: Partial<ApiProxyOptions>,
): ApiProxyOptions => {
  const next = {
    ...base,
    ...patch,
  };

  return {
    tauriForwardEnabled:
      typeof next.tauriForwardEnabled === "boolean"
        ? next.tauriForwardEnabled
        : false,
    proxyUrlEnabled:
      typeof next.proxyUrlEnabled === "boolean" ? next.proxyUrlEnabled : false,
    proxyUrl: (next.proxyUrl || "").trim(),
  };
};

export const mergeEditorOptions = (
  base: AppOptions,
  patch?: Partial<AppOptions>,
): AppOptions => {
  if (!patch) {
    return {
      ...base,
      apiProxy: normalizeApiProxyOptions(base.apiProxy),
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
    ...(patch.apiProxy
      ? {
          apiProxy: normalizeApiProxyOptions(base.apiProxy, patch.apiProxy),
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
    borderStyle: ANNOTATION_STYLES.shape.borderStyle,
    dashDensity: ANNOTATION_STYLES.shape.dashDensity,
    backgroundColor: ANNOTATION_STYLES.shape.backgroundColor,
    backgroundOpacity: ANNOTATION_STYLES.shape.backgroundOpacity,
    arrowSize: ANNOTATION_STYLES.shape.arrowSize,
    cloudIntensity: ANNOTATION_STYLES.shape.cloudIntensity,
    cloudSpacing: ANNOTATION_STYLES.shape.cloudSpacing,
  },
  stampStyle: {
    kind: ANNOTATION_STYLES.stamp.kind,
    presetId: ANNOTATION_STYLES.stamp.presetId,
    image: ANNOTATION_STYLES.stamp.image,
    imageAppearance: ANNOTATION_STYLES.stamp.imageAppearance,
    opacity: ANNOTATION_STYLES.stamp.opacity,
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
