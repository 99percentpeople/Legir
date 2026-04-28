import { createOpenAI } from "@ai-sdk/openai";

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

const OPENAI_REASONING_MODEL_RE =
  /^(o\d|gpt-5|gpt-4\.5|codex|computer-use|reasoning)/i;

const isOpenAiReasoningModel = (modelId: string) =>
  OPENAI_REASONING_MODEL_RE.test(modelId.trim());

const toOpenAiReasoningEffort = (
  effort: AiReasoningEffort,
): "low" | "medium" | "high" | undefined => {
  if (effort === "low" || effort === "medium" || effort === "high") {
    return effort;
  }
  return undefined;
};

const getOpenAiReasoningCapability = (
  modelId: string,
): AiReasoningCapability =>
  isOpenAiReasoningModel(modelId)
    ? {
        supported: true,
        supportsModeSwitch: false,
        supportsEffort: true,
        supportsBudgetTokens: false,
        textExposure: "none",
        requiresReasoningReplay: "none",
      }
    : NO_REASONING_CAPABILITY;

export const openAiRuntimeProfile: AiProviderRuntimeProfile = {
  providerId: "openai",

  createProvider: (config: AiSdkProviderConfig) =>
    createOpenAI({
      name: config.providerId,
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    }),

  getReasoningCapability: ({ modelId }) =>
    getOpenAiReasoningCapability(modelId),

  resolveReasoning: (request) => {
    const capability = getOpenAiReasoningCapability(request.modelId);
    if (!capability.supported || request.preference.mode === "off") {
      return createNoReasoningResolution({
        preference: request.preference,
        capability,
      });
    }

    const reasoningEffort = toOpenAiReasoningEffort(request.preference.effort);
    return {
      capability,
      effectivePreference: {
        ...request.preference,
        mode: "on",
        effort: reasoningEffort ?? "auto",
        displayPolicy:
          capability.textExposure !== "none"
            ? request.preference.displayPolicy
            : "hidden",
      },
      callOptions: reasoningEffort
        ? {
            providerOptions: {
              openai: { reasoningEffort },
            },
          }
        : undefined,
      replayPolicy: "none",
    };
  },
};
