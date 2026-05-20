import { createAnthropic } from "@ai-sdk/anthropic";
import { createMinimaxOpenAI } from "vercel-minimax-ai-provider";

import { getAiProviderModelReasoningMetadata } from "@/services/ai/providers/modelMetadata";
import type {
  AiProviderRuntimeProfile,
  AiReasoningEffort,
} from "@/services/ai/providers/runtimeProfiles/types";
import {
  createConservativeRuntimeProfile,
  createNoReasoningResolution,
} from "@/services/ai/providers/runtimeProfiles/shared";

const getMinimaxAnthropicBudgetTokens = (
  effort: AiReasoningEffort,
  explicitBudget?: number,
) => {
  if (explicitBudget && explicitBudget >= 1024) return explicitBudget;
  if (effort === "low") return 1024;
  if (effort === "high") return 8192;
  return 4096;
};

export const minimaxAnthropicRuntimeProfile: AiProviderRuntimeProfile = {
  providerId: "minimax",

  createProvider: (config) =>
    createAnthropic({
      name: config.providerId,
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    }),

  getReasoningCapability: ({ modelId }) =>
    getAiProviderModelReasoningMetadata("minimax", modelId),

  resolveReasoning: (request) => {
    const capability = getAiProviderModelReasoningMetadata(
      "minimax",
      request.modelId,
    );
    if (!capability.supported || request.preference.mode !== "on") {
      return createNoReasoningResolution({
        preference: request.preference,
        capability,
      });
    }

    const budgetTokens = getMinimaxAnthropicBudgetTokens(
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
          minimax: {
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

export const minimaxOpenAiRuntimeProfile = createConservativeRuntimeProfile({
  providerId: "minimax",
  createProvider: (config) =>
    createMinimaxOpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    }),
});
