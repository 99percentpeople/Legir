import { createOpenAI } from "@ai-sdk/openai";

import type { AiSdkProviderConfig } from "@/services/ai/providers/types";
import type {
  AiRuntimeAdapter,
  AiReasoningLevel,
} from "@/services/ai/providers/runtimeAdapters/types";
import {
  createNoReasoningResolution,
  selectReasoningLevel,
} from "@/services/ai/providers/runtimeAdapters/shared";
import { getAiProviderModelReasoningMetadata } from "@/services/ai/providers/metadata";

const toOpenAiReasoningEffort = (
  level: AiReasoningLevel,
): "minimal" | "low" | "medium" | "high" | "xhigh" | undefined => {
  if (
    level === "minimal" ||
    level === "low" ||
    level === "medium" ||
    level === "high" ||
    level === "xhigh"
  ) {
    return level;
  }
  return undefined;
};

export const openAiAdapter: AiRuntimeAdapter = {
  providerId: "openai",

  createSdkProvider: (config: AiSdkProviderConfig) =>
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

    const level = selectReasoningLevel(capability, request.preference.level);
    if (level === "none") {
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

    const reasoningEffort = toOpenAiReasoningEffort(level);
    return {
      capability,
      effectivePreference: {
        ...request.preference,
        level: reasoningEffort ?? "auto",
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
