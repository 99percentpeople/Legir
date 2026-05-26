import { createGoogleGenerativeAI } from "@ai-sdk/google";

import type { AiSdkProviderConfig } from "@/services/ai/providers/types";
import type {
  AiRuntimeAdapter,
  AiReasoningLevel,
} from "@/services/ai/providers/runtimeAdapters/types";
import {
  createNoReasoningResolution,
  getReasoningBudgetTokensForLevel,
  selectReasoningLevel,
} from "@/services/ai/providers/runtimeAdapters/shared";
import { getAiProviderModelReasoningMetadata } from "@/services/ai/providers/metadata";

const toGeminiThinkingLevel = (
  level: AiReasoningLevel,
): "low" | "medium" | "high" | undefined => {
  if (level === "low" || level === "medium" || level === "high") {
    return level;
  }
  return undefined;
};

const getGeminiThinkingOffCallOptions = (modelId: string) => {
  const capability = getAiProviderModelReasoningMetadata("gemini", modelId);
  if (capability.offStrategy !== "gemini-thinking-budget-zero") {
    return undefined;
  }

  return {
    providerOptions: {
      google: {
        thinkingConfig: {
          thinkingBudget: 0,
          includeThoughts: false,
        },
      },
    },
  };
};

export const geminiAdapter: AiRuntimeAdapter = {
  providerId: "gemini",

  createSdkProvider: (config: AiSdkProviderConfig) =>
    createGoogleGenerativeAI({
      name: config.providerId,
      apiKey: config.apiKey,
      fetch: config.fetch,
    }),

  getReasoningCapability: ({ modelId }) =>
    getAiProviderModelReasoningMetadata("gemini", modelId),

  resolveReasoning: (request) => {
    const capability = getAiProviderModelReasoningMetadata(
      "gemini",
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
      return {
        ...createNoReasoningResolution({
          preference: request.preference,
          capability,
        }),
        callOptions: getGeminiThinkingOffCallOptions(request.modelId),
      };
    }

    const thinkingLevel = toGeminiThinkingLevel(level);
    const budgetTokens = getReasoningBudgetTokensForLevel(capability, level);
    return {
      capability,
      effectivePreference: {
        ...request.preference,
        level,
      },
      callOptions: {
        providerOptions: {
          google: {
            thinkingConfig: {
              includeThoughts:
                request.preference.displayPolicy !== "hidden" &&
                capability.textExposure !== "none",
              ...(thinkingLevel ? { thinkingLevel } : {}),
              ...(budgetTokens ? { thinkingBudget: budgetTokens } : {}),
            },
          },
        },
      },
      replayPolicy: "none",
    };
  },
};
