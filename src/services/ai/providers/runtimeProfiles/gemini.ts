import { createGoogleGenerativeAI } from "@ai-sdk/google";

import type { AiSdkProviderConfig } from "@/services/ai/providers/types";
import type {
  AiProviderRuntimeProfile,
  AiReasoningEffort,
} from "@/services/ai/providers/runtimeProfiles/types";
import { createNoReasoningResolution } from "@/services/ai/providers/runtimeProfiles/shared";
import { getAiProviderModelReasoningMetadata } from "@/services/ai/providers/modelMetadata";

const toGeminiThinkingLevel = (
  effort: AiReasoningEffort,
): "low" | "medium" | "high" | undefined => {
  if (effort === "low" || effort === "medium" || effort === "high") {
    return effort;
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

export const geminiRuntimeProfile: AiProviderRuntimeProfile = {
  providerId: "gemini",

  createProvider: (config: AiSdkProviderConfig) =>
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

    if (request.preference.mode === "off") {
      return {
        ...createNoReasoningResolution({
          preference: request.preference,
          capability,
        }),
        callOptions: getGeminiThinkingOffCallOptions(request.modelId),
      };
    }

    const thinkingLevel = capability.supportsEffort
      ? toGeminiThinkingLevel(request.preference.effort)
      : undefined;
    return {
      capability,
      effectivePreference: {
        ...request.preference,
        mode: "on",
        effort: thinkingLevel ?? "auto",
      },
      callOptions: {
        providerOptions: {
          google: {
            thinkingConfig: {
              includeThoughts:
                request.preference.displayPolicy !== "hidden" &&
                capability.textExposure !== "none",
              ...(thinkingLevel ? { thinkingLevel } : {}),
              ...(capability.supportsBudgetTokens &&
              request.preference.budgetTokens
                ? { thinkingBudget: request.preference.budgetTokens }
                : {}),
            },
          },
        },
      },
      replayPolicy: "none",
    };
  },
};
