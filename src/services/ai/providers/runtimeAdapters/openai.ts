import type { AiRuntimeAdapter } from "./types";
import { createCatalogReasoningAdapter } from "./catalogReasoning";

export const openAiAdapter: AiRuntimeAdapter = {
  providerId: "openai",
  ...createCatalogReasoningAdapter("openai"),
  createSdkProvider: async (config) => {
    const { createOpenAI } = await import("@ai-sdk/openai");
    return createOpenAI({
      name: config.providerId,
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    });
  },
};
