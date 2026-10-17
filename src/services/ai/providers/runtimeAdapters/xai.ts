import type { AiRuntimeAdapter } from "./types";
import { createCatalogReasoningAdapter } from "./catalogReasoning";

export const xaiAdapter: AiRuntimeAdapter = {
  providerId: "xai",
  ...createCatalogReasoningAdapter("xai"),
  createSdkProvider: async (config) => {
    const { createXai } = await import("@ai-sdk/xai");
    return createXai({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    });
  },
};
