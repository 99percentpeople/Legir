import { createAnthropic } from "@ai-sdk/anthropic";

import type { AiSdkProviderConfig } from "@/services/ai/providers/types";
import type {
  AiProviderRuntimeProfile,
  AiReasoningEffort,
} from "@/services/ai/providers/runtimeProfiles/types";
import { createNoReasoningResolution } from "@/services/ai/providers/runtimeProfiles/shared";
import { getAiProviderModelReasoningMetadata } from "@/services/ai/providers/modelMetadata";

const getAnthropicBudgetTokens = (
  effort: AiReasoningEffort,
  explicitBudget?: number,
) => {
  if (explicitBudget && explicitBudget >= 1024) return explicitBudget;
  if (effort === "low") return 1024;
  if (effort === "high") return 8192;
  return 4096;
};

export const anthropicRuntimeProfile: AiProviderRuntimeProfile = {
  providerId: "anthropic",

  createProvider: (config: AiSdkProviderConfig) =>
    createAnthropic({
      name: config.providerId,
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    }),

  getReasoningCapability: ({ modelId }) =>
    getAiProviderModelReasoningMetadata("anthropic", modelId),

  resolveReasoning: (request) => {
    const capability = getAiProviderModelReasoningMetadata(
      "anthropic",
      request.modelId,
    );
    if (!capability.supported || request.preference.mode !== "on") {
      return createNoReasoningResolution({
        preference: request.preference,
        capability,
      });
    }

    const budgetTokens = getAnthropicBudgetTokens(
      request.preference.effort,
      request.preference.budgetTokens,
    );
    return {
      capability,
      effectivePreference: {
        ...request.preference,
        mode: "on",
        effort: "auto",
        budgetTokens,
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
};
