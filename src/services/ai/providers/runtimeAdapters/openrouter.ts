import { createOpenRouter } from "@openrouter/ai-sdk-provider";

import { createBasicRuntimeAdapter } from "@/services/ai/providers/runtimeAdapters/shared";

export const openRouterAdapter = createBasicRuntimeAdapter({
  providerId: "openrouter",
  createSdkProvider: (config) =>
    createOpenRouter({
      apiKey: config.apiKey,
      compatibility: "strict",
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    }),
});
