import type { AiRuntimeAdapter } from "./types";
import { createCatalogReasoningAdapter } from "./catalogReasoning";

export const geminiAdapter: AiRuntimeAdapter = {
  providerId: "gemini",
  supportsImageToolResults: true,
  ...createCatalogReasoningAdapter("google"),
  createSdkProvider: async (config) => {
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
    return createGoogleGenerativeAI({
      name: config.providerId,
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    });
  },
};
