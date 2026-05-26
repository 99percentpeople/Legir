import {
  AI_PROVIDER_IDS,
  type AiProviderId,
} from "@/services/ai/providers/catalog";
import {
  getAiSdkModelGroups,
  getAiSdkModelCatalogProvider,
  getAiSdkProviderModelOptions,
  isAiSdkProviderConfigured,
} from "@/services/ai/providers";
import {
  getCurrentModelCache,
  getCurrentOptions,
  trimProviderOptions,
  type SupportedLlmProviderId,
} from "@/services/ai/editorState";
import { registerTranslateOptionsFromProviders } from "@/services/ai/translation";
import { useEditorStore } from "@/store/useEditorStore";
import type { LLMModelOption } from "@/services/ai/types";
import type { AppOptions } from "@/types";

type ModelKind = "translate" | "vision" | "chat" | "summarize";

const llmModelRegistryListeners = new Set<() => void>();

export const subscribeLLMModelRegistry = (listener: () => void) => {
  llmModelRegistryListeners.add(listener);
  return () => {
    llmModelRegistryListeners.delete(listener);
  };
};

registerTranslateOptionsFromProviders();

const checkAiSdkProviderConfig = async (options: {
  appOptions: AppOptions;
  providerId: AiProviderId;
}) => {
  await getAiSdkModelCatalogProvider(options.providerId).checkConfig({
    appOptions: options.appOptions,
  });
};

const fetchAiSdkProviderModels = async (options: {
  appOptions: AppOptions;
  providerId: AiProviderId;
}) =>
  getAiSdkModelCatalogProvider(options.providerId).fetchModels({
    appOptions: options.appOptions,
  });

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
  await checkAiSdkProviderConfig({
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
        models: [],
      };
      continue;
    }

    const currentModels = previousCache[providerId]?.models ?? [];
    if (!force && currentModels.length > 0) {
      continue;
    }

    try {
      const fetchedModels = await fetchAiSdkProviderModels({
        appOptions,
        providerId,
      });

      nextCache[providerId] = {
        models: fetchedModels,
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

export const getProviderTextModelOptions = (
  providerId: AiProviderId,
  kind: ModelKind,
) =>
  getAiSdkProviderModelOptions({
    appOptions: getCurrentOptions(),
    modelCache: getCurrentModelCache(),
    providerId,
    kind,
  });
