import { createAnthropic } from "@ai-sdk/anthropic";

import type { AiSdkProviderConfig } from "@/services/ai/providers/types";
import type {
  AiProviderRuntimeProfile,
  AiReasoningCapability,
  AiReasoningEffort,
  AiReasoningTextExposure,
} from "@/services/ai/providers/runtimeProfiles/types";
import {
  createNoReasoningResolution,
  NO_REASONING_CAPABILITY,
} from "@/services/ai/providers/runtimeProfiles/shared";

const ANTHROPIC_REASONING_MODEL_RE =
  /(claude.*(3[.-]?7|4|sonnet|opus)|minimax.*m2|m2\.)/i;

const getAnthropicBudgetTokens = (
  effort: AiReasoningEffort,
  explicitBudget?: number,
) => {
  if (explicitBudget && explicitBudget >= 1024) return explicitBudget;
  if (effort === "low") return 1024;
  if (effort === "high") return 8192;
  return 4096;
};

const getAnthropicReasoningCapability = (
  modelId: string,
  textExposure: AiReasoningTextExposure,
): AiReasoningCapability =>
  ANTHROPIC_REASONING_MODEL_RE.test(modelId)
    ? {
        supported: true,
        supportsModeSwitch: true,
        supportsEffort: false,
        supportsBudgetTokens: true,
        textExposure,
        requiresReasoningReplay: "all",
      }
    : NO_REASONING_CAPABILITY;

export const createAnthropicRuntimeProfile = (
  providerId: "anthropic" | "minimax",
  options?: {
    textExposure?: AiReasoningTextExposure;
  },
): AiProviderRuntimeProfile => ({
  providerId,

  createProvider: (config: AiSdkProviderConfig) =>
    createAnthropic({
      name: config.providerId,
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    }),

  getReasoningCapability: ({ modelId }) =>
    getAnthropicReasoningCapability(
      modelId,
      options?.textExposure ?? "summary",
    ),

  resolveReasoning: (request) => {
    const capability = getAnthropicReasoningCapability(
      request.modelId,
      options?.textExposure ?? "summary",
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
});

export const anthropicRuntimeProfile =
  createAnthropicRuntimeProfile("anthropic");
