import type { AiSdkProviderId } from "../types";
import type { AiRuntimeAdapter } from "./types";
import { createCatalogReasoningAdapter } from "./catalogReasoning";

export const createOpenAiCompatibleAdapter = (
  providerId: AiSdkProviderId,
): AiRuntimeAdapter => ({
  providerId,
  ...createCatalogReasoningAdapter("openai-compatible"),
  createSdkProvider: async (config) => {
    if (!config.baseURL)
      throw new Error(`${config.label} requires a custom API URL.`);
    const { createOpenAICompatible } =
      await import("@ai-sdk/openai-compatible");
    return createOpenAICompatible({
      name: config.providerId,
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      supportsStructuredOutputs: true,
      fetch: config.fetch,
    });
  },
});
