import { type AiProviderId } from "@/services/ai/providers/catalog";
import {
  getAiSdkModelGroups,
  getAiSdkProviderModelOptions,
  type AiSdkModelGroup,
} from "@/services/ai/providers/modelSelection";
import { getAiSdkModelCatalogProvider } from "@/services/ai/providers/modelCatalogRegistry";
import { isAiSdkProviderConfigured } from "@/services/ai/providers/settings";
import {
  getCurrentModelCache,
  getCurrentOptions,
  trimProviderOptions,
} from "@/services/ai/editorState";
import { registerTranslateOptionsFromProviders } from "@/services/ai/translation";
import { preferencesStore } from "@/store/preferencesStore";
import type { AppOptions } from "@/types";
import {
  initializeModelsDev,
  refreshModelsDev,
  subscribeModelsDev,
} from "./providers/modelsDev";
import {
  getConnectionCacheKey,
  MODEL_CACHE_TTL_MS,
} from "./providers/modelCatalog/base";

type ModelKind = "translate" | "vision" | "chat" | "summarize";

const llmModelRegistryListeners = new Set<() => void>();

export const subscribeLLMModelRegistry = (listener: () => void) => {
  llmModelRegistryListeners.add(listener);
  return () => {
    llmModelRegistryListeners.delete(listener);
  };
};

const notifyRegistry = () => {
  registerTranslateOptionsFromProviders();
  for (const listener of llmModelRegistryListeners) listener();
};
subscribeModelsDev(notifyRegistry);
// Availability changes immediately, even if settings close before the fetch debounce.
preferencesStore.subscribe((state, previous) => {
  if (state.options.llm !== previous.options.llm) notifyRegistry();
});
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
  const appOptions = trimProviderOptions();
  if (!Object.hasOwn(appOptions.llm, providerId))
    throw new Error(`Unknown AI connection: ${providerId}`);
  await checkAiSdkProviderConfig({ appOptions, providerId });
};

export const loadModels = async (options?: LoadModelsOptions) => {
  if (!Object.keys(getCurrentOptions().llm).length) {
    notifyRegistry();
    return;
  }
  await initializeModelsDev();
  void refreshModelsDev().catch(() => {});
  const appOptions = getCurrentOptions();
  const ids = Object.keys(appOptions.llm).filter(
    (id) => !options?.providerIds?.length || options.providerIds.includes(id),
  );
  notifyRegistry();
  await Promise.all(
    ids.map(async (providerId) => {
      const key = getConnectionCacheKey(appOptions, providerId);
      const cache = getCurrentModelCache()[providerId];
      if (!isAiSdkProviderConfigured(appOptions, providerId)) return;
      if (
        !options?.force &&
        cache?.configurationKey === key &&
        cache.fetchedAt &&
        Date.now() - cache.fetchedAt < MODEL_CACHE_TTL_MS
      )
        return;
      try {
        const models = await fetchAiSdkProviderModels({
          appOptions,
          providerId,
        });
        // A response from an edited/deleted connection must not overwrite the new configuration.
        const current = getCurrentOptions();
        if (
          !Object.hasOwn(current.llm, providerId) ||
          getConnectionCacheKey(current, providerId) !== key
        )
          return;
        preferencesStore.setState((state) => ({
          llmModelCache: {
            ...state.llmModelCache,
            [providerId]: {
              models,
              configurationKey: key,
              fetchedAt: Date.now(),
            },
          },
        }));
      } catch (error) {
        if (options?.throwOnError) throw error;
      } finally {
        notifyRegistry();
      }
    }),
  );
};

export type VisionModelGroup = AiSdkModelGroup;

export const getVisionModelGroups = (): VisionModelGroup[] =>
  getAiSdkModelGroups({
    appOptions: getCurrentOptions(),
    modelCache: getCurrentModelCache(),
    kind: "vision",
  });

export type ChatModelGroup = AiSdkModelGroup;

export const isChatAgentAvailable = () =>
  Object.keys(getCurrentOptions().llm).some((providerId) =>
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
