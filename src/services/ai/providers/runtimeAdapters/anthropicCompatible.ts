import { createAnthropic } from "@ai-sdk/anthropic";

import type { AiSdkProviderConfig } from "@/services/ai/providers/types";
import type { AiRuntimeAdapter } from "@/services/ai/providers/runtimeAdapters/types";
import {
  createNoReasoningResolution,
  getReasoningBudgetTokensForLevel,
  selectReasoningLevel,
} from "@/services/ai/providers/runtimeAdapters/shared";
import { getAiProviderModelReasoningMetadata } from "@/services/ai/providers/metadata";

const DEFAULT_ANTHROPIC_BUDGET_TOKENS = 4096;

type AnthropicCompatibleAdapterOptions = {
  authMode?: "api-key" | "bearer";
};

export const createAnthropicCompatibleAdapter = (
  providerId: AiRuntimeAdapter["providerId"],
  options: AnthropicCompatibleAdapterOptions = {},
): AiRuntimeAdapter => ({
  providerId,
  createSdkProvider: (config: AiSdkProviderConfig) =>
    createAnthropic({
      name: config.providerId,
      ...(options.authMode === "bearer"
        ? { authToken: config.apiKey }
        : { apiKey: config.apiKey }),
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    }),

  getReasoningCapability: ({ providerId, modelId }) =>
    getAiProviderModelReasoningMetadata(providerId, modelId),

  resolveReasoning: (request) => {
    const capability = getAiProviderModelReasoningMetadata(
      request.providerId,
      request.modelId,
    );
    if (!capability.supported) {
      return createNoReasoningResolution({
        preference: request.preference,
        capability,
      });
    }

    const level = selectReasoningLevel(capability, request.preference.level);
    if (level === "none") {
      return createNoReasoningResolution({
        preference: request.preference,
        capability,
      });
    }

    const budgetTokens =
      getReasoningBudgetTokensForLevel(capability, level) ??
      DEFAULT_ANTHROPIC_BUDGET_TOKENS;
    return {
      capability,
      effectivePreference: {
        ...request.preference,
        level,
      },
      callOptions: {
        providerOptions: {
          [request.providerId]: {
            thinking: {
              type: "enabled",
              budgetTokens,
            },
            sendReasoning: true,
          },
        },
      },
      replayPolicy: "all",
    };
  },
});

export const anthropicCompatibleAdapter = createAnthropicCompatibleAdapter(
  "anthropic-compatible",
);
