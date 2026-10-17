import type { AiRuntimeAdapter } from "./types";
import { createCatalogReasoningAdapter } from "./catalogReasoning";

export const openRouterAdapter: AiRuntimeAdapter = {
  providerId: "openrouter",
  ...createCatalogReasoningAdapter("openrouter"),
  createSdkProvider: async (config) => {
    const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
    return createOpenRouter({
      compatibility: "strict",
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    });
  },
};
