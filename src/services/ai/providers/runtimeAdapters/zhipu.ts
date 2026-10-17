import type { AiRuntimeAdapter } from "./types";
import { createCatalogReasoningAdapter } from "./catalogReasoning";

export const zhipuAdapter: AiRuntimeAdapter = {
  providerId: "zhipu",
  ...createCatalogReasoningAdapter("zhipu"),
  createSdkProvider: async (config) => {
    const { createZhipu } = await import("zhipu-ai-provider");
    return createZhipu({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    });
  },
};
