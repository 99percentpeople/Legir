import { createOpenAI } from "@ai-sdk/openai";

import type { AiSdkProviderConfig } from "@/services/ai/providers/types";
import type {
  AiProviderRuntimeProfile,
  AiReasoningEffort,
} from "@/services/ai/providers/runtimeProfiles/types";
import { createNoReasoningResolution } from "@/services/ai/providers/runtimeProfiles/shared";
import { getAiProviderModelReasoningMetadata } from "@/services/ai/providers/modelMetadata";

const toOpenAiReasoningEffort = (
  effort: AiReasoningEffort,
): "low" | "medium" | "high" | undefined => {
  if (effort === "low" || effort === "medium" || effort === "high") {
    return effort;
  }
  return undefined;
};

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
    getAiProviderModelReasoningMetadata("openai", modelId),

  resolveReasoning: (request) => {
    const capability = getAiProviderModelReasoningMetadata(
      "openai",
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
        callOptions:
          capability.offStrategy === "openai-reasoning-effort-none"
            ? {
                providerOptions: {
                  openai: { reasoningEffort: "none" },
                },
              }
            : undefined,
      };
    }

    const reasoningEffort = capability.supportsEffort
      ? toOpenAiReasoningEffort(request.preference.effort)
      : undefined;
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
