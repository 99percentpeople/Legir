import type { AiRuntimeAdapter } from "./types";
import { createCatalogReasoningAdapter } from "./catalogReasoning";

type AnthropicCompatibleAdapterOptions = { authMode?: "api-key" | "bearer" };

export const createAnthropicCompatibleAdapter = (
  providerId: AiRuntimeAdapter["providerId"],
  options: AnthropicCompatibleAdapterOptions = {},
): AiRuntimeAdapter => ({
  providerId,
  ...createCatalogReasoningAdapter("anthropic"),
  createSdkProvider: async (config) => {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    return createAnthropic({
      name: config.providerId,
      ...(options.authMode === "bearer"
        ? { authToken: config.apiKey }
        : { apiKey: config.apiKey }),
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    });
  },
});
export const anthropicCompatibleAdapter = createAnthropicCompatibleAdapter(
  "anthropic-compatible",
);
