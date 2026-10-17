import type { AiRuntimeAdapter } from "./types";
import { createCatalogReasoningAdapter } from "./catalogReasoning";

export const groqAdapter: AiRuntimeAdapter = {
  providerId: "groq",
  ...createCatalogReasoningAdapter("groq"),
  createSdkProvider: async (config) => {
    const { createGroq } = await import("@ai-sdk/groq");
    return createGroq({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    });
  },
};
