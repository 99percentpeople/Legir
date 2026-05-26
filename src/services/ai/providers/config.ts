import { createProviderRegistry, type ProviderRegistryProvider } from "ai";
import type { ProviderV3 } from "@ai-sdk/provider";

import { createAiSdkProvider } from "@/services/ai/providers/registry";
import { getConfiguredAiSdkProviders } from "@/services/ai/providers/settings";
import { createApiProxyFetch } from "@/services/platform/apiProxy";
import type { AppOptions } from "@/types";

export {
  AI_PROVIDER_LABELS,
  getConfiguredAiSdkProvider,
  getConfiguredAiSdkProviders,
  isAiSdkProviderConfigured,
  isAiSdkProviderEnabled,
  normalizeBaseUrl,
  normalizeOptionalText,
} from "@/services/ai/providers/settings";

export const createAiSdkProviders = (options: AppOptions) => {
  const providers: Record<string, ProviderV3> = {};
  const proxyFetch = createApiProxyFetch(options);

  for (const config of getConfiguredAiSdkProviders(options)) {
    providers[config.providerId] = createAiSdkProvider({
      ...config,
      fetch: proxyFetch,
    });
  }

  return providers;
};

export const createAiSdkProviderRegistry = (options: AppOptions) => {
  return createProviderRegistry(
    createAiSdkProviders(options),
  ) as ProviderRegistryProvider<Record<string, ProviderV3>>;
};
