import {
  getAiProviderSpec,
  type AiProviderId,
} from "@/services/ai/providers/catalog";
import { getAiSdkModelCatalogProvider } from "@/services/ai/providers/registry";
import { getConfiguredAiSdkProvider } from "@/services/ai/providers/config";
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

export const getAiSdkFallbackModelId = (providerId: AiProviderId) =>
  getAiProviderSpec(providerId).fallbackModelId || "";
