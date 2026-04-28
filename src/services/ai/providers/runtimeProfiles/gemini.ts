import { createGoogleGenerativeAI } from "@ai-sdk/google";

import type { AiSdkProviderConfig } from "@/services/ai/providers/types";
import type {
  AiProviderRuntimeProfile,
  AiReasoningCapability,
  AiReasoningEffort,
} from "@/services/ai/providers/runtimeProfiles/types";
import {
  createNoReasoningResolution,
  NO_REASONING_CAPABILITY,
} from "@/services/ai/providers/runtimeProfiles/shared";
import { isSupportedGeminiThinkingModelId } from "@/services/ai/utils/geminiModelSupport";

const toGeminiThinkingLevel = (
  effort: AiReasoningEffort,
): "low" | "medium" | "high" | undefined => {
  if (effort === "low" || effort === "medium" || effort === "high") {
    return effort;
  }
  return undefined;
};

const getGeminiReasoningCapability = (
  modelId: string,
): AiReasoningCapability =>
  isSupportedGeminiThinkingModelId(modelId)
    ? {
        supported: true,
        supportsModeSwitch: true,
        supportsEffort: true,
        supportsBudgetTokens: true,
        textExposure: "summary",
        requiresReasoningReplay: "none",
      }
    : NO_REASONING_CAPABILITY;

export const geminiRuntimeProfile: AiProviderRuntimeProfile = {
  providerId: "gemini",

  createProvider: (config: AiSdkProviderConfig) =>
    createGoogleGenerativeAI({
      name: config.providerId,
      apiKey: config.apiKey,
      fetch: config.fetch,
    }),

  getReasoningCapability: ({ modelId }) =>
    getGeminiReasoningCapability(modelId),

  resolveReasoning: (request) => {
    const capability = getGeminiReasoningCapability(request.modelId);
    if (!capability.supported || request.preference.mode === "off") {
      return createNoReasoningResolution({
        preference: request.preference,
        capability,
      });
    }

    const thinkingLevel = toGeminiThinkingLevel(request.preference.effort);
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
              ...(request.preference.budgetTokens
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
