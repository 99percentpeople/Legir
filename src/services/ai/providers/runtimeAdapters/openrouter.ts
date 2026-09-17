import { createBasicRuntimeAdapter } from "@/services/ai/providers/runtimeAdapters/shared";

export const openRouterAdapter = createBasicRuntimeAdapter({
  providerId: "openrouter",
  createSdkProvider: async (config) => {
    const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
    return createOpenRouter({
      apiKey: config.apiKey,
      compatibility: "strict",
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    });
  },
});
