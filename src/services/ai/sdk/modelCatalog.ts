import {
  getAiProviderSpec,
  type AiProviderId,
} from "@/services/ai/sdk/providerCatalog";
import { getAiSdkModelCatalogProvider } from "@/services/ai/sdk/modelCatalogProviders";
import { getConfiguredAiSdkProvider } from "@/services/ai/sdk/providers";
import type { AppOptions } from "@/types";

export const isAiSdkProviderConfigured = (
  options: AppOptions,
  providerId: AiProviderId,
) => {
  return getConfiguredAiSdkProvider(options, providerId) !== null;
};

export const checkAiSdkProviderConfig = async (options: {
  appOptions: AppOptions;
  providerId: AiProviderId;
  signal?: AbortSignal;
}) => {
  await getAiSdkModelCatalogProvider(options.providerId).checkConfig({
    appOptions: options.appOptions,
    signal: options.signal,
  });
};

export const fetchAiSdkProviderModels = async (options: {
  appOptions: AppOptions;
  providerId: AiProviderId;
  signal?: AbortSignal;
}) => {
  return await getAiSdkModelCatalogProvider(options.providerId).fetchModels({
    appOptions: options.appOptions,
    signal: options.signal,
  });
};

export const getAiSdkFallbackModelId = (options: {
  appOptions: AppOptions;
  providerId: AiProviderId;
}) => {
  void options.appOptions;
  return getAiProviderSpec(options.providerId).fallbackModelId || "";
};
