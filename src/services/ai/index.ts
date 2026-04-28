import type { FormField } from "@/types";
import { useEditorStore } from "@/store/useEditorStore";
import { translateService } from "@/services/translateService";
import {
  AI_PROVIDER_IDS,
  type AiProviderId,
} from "@/services/ai/providers/catalog";
import {
  checkAiSdkProviderConfig as checkAiSdkProviderConfigWithAiSdk,
  fetchAiSdkProviderModels,
  getAiSdkModelGroups,
  getAiSdkProviderModelOptions,
  isAiSdkProviderConfigured,
  resolveAiSdkModelSpecifierForTask,
} from "@/services/ai/providers";
import {
  analyzePageForFieldsWithAiSdk,
  summarizePageImagesWithAiSdk,
  summarizeTextWithAiSdk,
  translateTextStreamWithAiSdk,
  translateTextWithAiSdk,
} from "@/services/ai/tasks";
import type {
  LLMAnalyzePageForFieldsOptions,
  LLMModelOption,
  LLMTranslateTextOptions,
} from "./types";
import type {
  AiRenderedPageImage,
  AiSummaryInstructions,
} from "@/services/ai/chat/types";

export * from "@/services/ai/providers";
export * from "@/services/ai/tasks";

type SupportedLlmProviderId = AiProviderId;
type ModelKind = "translate" | "vision" | "chat" | "summarize";

const llmModelRegistryListeners = new Set<() => void>();

const subscribeLLMModelRegistry = (listener: () => void) => {
  llmModelRegistryListeners.add(listener);
  return () => {
    llmModelRegistryListeners.delete(listener);
  };
};

export { subscribeLLMModelRegistry };

const getCurrentOptions = () => useEditorStore.getState().options;

const getCurrentModelCache = () => useEditorStore.getState().llmModelCache;

const trimProviderOptions = () => {
  const snapshot = useEditorStore.getState();
  const nextOptions = snapshot.options;
  const nextLlm = Object.fromEntries(
    AI_PROVIDER_IDS.map((providerId) => [
      providerId,
      {
        ...nextOptions.llm[providerId],
        apiKey: (nextOptions.llm[providerId].apiKey || "").trim(),
        apiUrl: (nextOptions.llm[providerId].apiUrl || "").trim(),
        apiOptionId: (nextOptions.llm[providerId].apiOptionId || "").trim(),
      },
    ]),
  ) as typeof nextOptions.llm;

  const isChanged = AI_PROVIDER_IDS.some((providerId) => {
    const previous = nextOptions.llm[providerId];
    const normalized = nextLlm[providerId];
    return (
      previous.apiKey !== normalized.apiKey ||
      previous.apiUrl !== normalized.apiUrl ||
      previous.apiOptionId !== normalized.apiOptionId
    );
  });

  if (!isChanged) {
    return snapshot.options;
  }

  snapshot.setOptions((options) => ({
    ...options,
    llm: nextLlm,
  }));

  return useEditorStore.getState().options;
};

const registerTranslateOptionsFromProviders = () => {
  const appOptions = getCurrentOptions();
  const modelCache = getCurrentModelCache();
  const groups = getAiSdkModelGroups({
    appOptions,
    modelCache,
    kind: "translate",
  });

  for (const group of groups) {
    translateService.registerOptionGroup({
      id: group.providerId,
      label: group.label,
      labelKey: group.labelKey,
      options: group.models.map((model) => ({
        id: model.id,
        label: model.label,
        labelKey: model.labelKey,
        capabilities: model.capabilities,
      })),
      isLLM: true,
      isAvailable: () =>
        isAiSdkProviderConfigured(getCurrentOptions(), group.providerId),
      unavailableMessageKey: group.unavailableMessageKey,
      translate: async (text, optionId, translateOptions) => {
        return await translateTextWithAiSdk({
          text,
          appOptions: getCurrentOptions(),
          specifier: {
            providerId: group.providerId,
            modelId: optionId,
          },
          targetLanguage: translateOptions.targetLanguage,
          sourceLanguage: translateOptions.sourceLanguage,
          prompt: translateOptions.prompt,
          signal: translateOptions.signal,
        });
      },
      translateStream: (text, optionId, translateOptions) => {
        return translateTextStreamWithAiSdk({
          text,
          appOptions: getCurrentOptions(),
          specifier: {
            providerId: group.providerId,
            modelId: optionId,
          },
          targetLanguage: translateOptions.targetLanguage,
          sourceLanguage: translateOptions.sourceLanguage,
          prompt: translateOptions.prompt,
          signal: translateOptions.signal,
        });
      },
    });
  }
};

registerTranslateOptionsFromProviders();

export type LoadModelsOptions = {
  providerIds?: string[];
  force?: boolean;
  throwOnError?: boolean;
};

export const checkLlmProviderConfig = async (providerId: string) => {
  if (!AI_PROVIDER_IDS.includes(providerId as SupportedLlmProviderId)) {
    throw new Error(`Unknown LLM provider: ${providerId}`);
  }

  const appOptions = trimProviderOptions();
  await checkAiSdkProviderConfigWithAiSdk({
    appOptions,
    providerId: providerId as SupportedLlmProviderId,
  });
};

export const loadModels = async (options?: LoadModelsOptions) => {
  const providerIdSet =
    options?.providerIds && options.providerIds.length > 0
      ? new Set(
          options.providerIds.filter((id): id is SupportedLlmProviderId =>
            AI_PROVIDER_IDS.includes(id as SupportedLlmProviderId),
          ),
        )
      : null;
  const force = options?.force === true;
  const throwOnError = options?.throwOnError === true;
  const appOptions = trimProviderOptions();
  const previousCache = getCurrentModelCache();

  const nextCache = {
    ...previousCache,
  };

  for (const providerId of AI_PROVIDER_IDS) {
    if (providerIdSet && !providerIdSet.has(providerId)) {
      continue;
    }

    if (!isAiSdkProviderConfigured(appOptions, providerId)) {
      nextCache[providerId] = {
        translateModels: [],
        visionModels: [],
      };
      continue;
    }

    const currentTranslateModels = previousCache[providerId].translateModels;
    if (!force && currentTranslateModels.length > 0) {
      continue;
    }

    try {
      const fetchedModels = await fetchAiSdkProviderModels({
        appOptions,
        providerId,
      });

      nextCache[providerId] = {
        translateModels: fetchedModels,
        visionModels: fetchedModels,
      };
    } catch (error) {
      if (throwOnError) {
        throw error;
      }
    }
  }

  useEditorStore.getState().setState({
    llmModelCache: nextCache,
  });

  registerTranslateOptionsFromProviders();

  for (const listener of llmModelRegistryListeners) {
    listener();
  }
};

void loadModels();

export const isFormDetectAvailable = () =>
  AI_PROVIDER_IDS.some((providerId) =>
    isAiSdkProviderConfigured(getCurrentOptions(), providerId),
  );

export const getFormDetectModels = (): LLMModelOption[] => {
  const groups = getAiSdkModelGroups({
    appOptions: getCurrentOptions(),
    modelCache: getCurrentModelCache(),
    kind: "vision",
  });
  return groups.find((group) => group.models.length > 0)?.models || [];
};

export type FormDetectModelGroup = {
  providerId: string;
  label: string;
  labelKey?: string;
  isAvailable: boolean;
  unavailableMessageKey?: string;
  models: LLMModelOption[];
};

export const getVisionModelGroups = (): FormDetectModelGroup[] =>
  getAiSdkModelGroups({
    appOptions: getCurrentOptions(),
    modelCache: getCurrentModelCache(),
    kind: "vision",
  });

export const getFormDetectModelGroups = (): FormDetectModelGroup[] =>
  getVisionModelGroups();

export type ChatModelGroup = {
  providerId: string;
  label: string;
  labelKey?: string;
  isAvailable: boolean;
  unavailableMessageKey?: string;
  models: LLMModelOption[];
};

export const isChatAgentAvailable = () =>
  AI_PROVIDER_IDS.some((providerId) =>
    isAiSdkProviderConfigured(getCurrentOptions(), providerId),
  );

export const getChatModelGroups = (): ChatModelGroup[] =>
  getAiSdkModelGroups({
    appOptions: getCurrentOptions(),
    modelCache: getCurrentModelCache(),
    kind: "chat",
  });

export type TranslateTextOptions = LLMTranslateTextOptions;
export type TranslateTextStreamOptions = LLMTranslateTextOptions;
export type AIAnalysisOptions = LLMAnalyzePageForFieldsOptions;

export const translateText = async (
  text: string,
  options: TranslateTextOptions,
) => {
  const specifier = resolveAiSdkModelSpecifierForTask({
    appOptions: getCurrentOptions(),
    modelCache: getCurrentModelCache(),
    kind: "translate",
    modelId: options.modelId,
  });
  return await translateTextWithAiSdk({
    text,
    appOptions: getCurrentOptions(),
    specifier,
    targetLanguage: options.targetLanguage,
    sourceLanguage: options.sourceLanguage,
    prompt: options.prompt,
    signal: options.signal,
  });
};

export async function* translateTextStream(
  text: string,
  options: TranslateTextStreamOptions,
): AsyncGenerator<string> {
  const specifier = resolveAiSdkModelSpecifierForTask({
    appOptions: getCurrentOptions(),
    modelCache: getCurrentModelCache(),
    kind: "translate",
    modelId: options.modelId,
  });
  yield* translateTextStreamWithAiSdk({
    text,
    appOptions: getCurrentOptions(),
    specifier,
    targetLanguage: options.targetLanguage,
    sourceLanguage: options.sourceLanguage,
    prompt: options.prompt,
    signal: options.signal,
  });
}

export const analyzePageForFields = async (
  base64Image: string,
  pageIndex: number,
  pageWidth: number,
  pageHeight: number,
  existingFields: FormField[] = [],
  options?: AIAnalysisOptions,
) => {
  const specifier = resolveAiSdkModelSpecifierForTask({
    appOptions: getCurrentOptions(),
    modelCache: getCurrentModelCache(),
    kind: "vision",
    providerId: options?.providerId,
    modelId: options?.modelId,
  });
  return await analyzePageForFieldsWithAiSdk({
    appOptions: getCurrentOptions(),
    specifier,
    base64Image,
    pageIndex,
    pageWidth,
    pageHeight,
    existingFields,
    analyzeOptions: options,
    signal: undefined,
  });
};

const resolveSummarizeSpecifier = (options: {
  providerId?: string;
  modelId?: string;
}) =>
  resolveAiSdkModelSpecifierForTask({
    appOptions: getCurrentOptions(),
    modelCache: getCurrentModelCache(),
    kind: "summarize",
    modelKey:
      options.providerId && options.modelId
        ? `${options.providerId}:${options.modelId}`
        : undefined,
    providerId: options.providerId,
    modelId: options.modelId,
  });

export type SummarizeDigestTextOptions = {
  providerId?: string;
  modelId?: string;
  prompt?: string;
  signal?: AbortSignal;
};

export const summarizeDigestText = async (
  text: string,
  options: SummarizeDigestTextOptions,
) => {
  const specifier = resolveSummarizeSpecifier(options);

  return await summarizeTextWithAiSdk({
    text,
    appOptions: getCurrentOptions(),
    specifier,
    prompt: options.prompt,
    signal: options.signal,
  });
};

export type SummarizeConversationMemoryOptions = {
  providerId?: string;
  modelId?: string;
  system?: string;
  signal?: AbortSignal;
};

export const summarizeConversationMemory = async (
  text: string,
  options: SummarizeConversationMemoryOptions,
) => {
  const specifier = resolveSummarizeSpecifier(options);

  return await summarizeTextWithAiSdk({
    text,
    appOptions: getCurrentOptions(),
    specifier,
    system: options.system,
    signal: options.signal,
  });
};

export type SummarizePageImagesOptions = {
  modelKey?: string;
  providerId?: string;
  modelId?: string;
  summaryInstructions?: AiSummaryInstructions;
  signal?: AbortSignal;
};

export const summarizePageImages = async (
  pages: AiRenderedPageImage[],
  options: SummarizePageImagesOptions,
) => {
  const specifier = resolveAiSdkModelSpecifierForTask({
    appOptions: getCurrentOptions(),
    modelCache: getCurrentModelCache(),
    kind: "vision",
    modelKey: options.modelKey,
    providerId: options.providerId,
    modelId: options.modelId,
  });

  return await summarizePageImagesWithAiSdk({
    appOptions: getCurrentOptions(),
    specifier,
    pages,
    summaryInstructions: options.summaryInstructions,
    signal: options.signal,
  });
};

export const getProviderTextModelOptions = (
  providerId: SupportedLlmProviderId,
  kind: ModelKind,
) =>
  getAiSdkProviderModelOptions({
    appOptions: getCurrentOptions(),
    modelCache: getCurrentModelCache(),
    providerId,
    kind,
  });
