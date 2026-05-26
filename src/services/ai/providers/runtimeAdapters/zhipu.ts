import { createZhipu } from "zhipu-ai-provider";

import {
  createNoReasoningResolution,
  selectReasoningLevel,
} from "@/services/ai/providers/runtimeAdapters/shared";
import type { AiRuntimeAdapter } from "@/services/ai/providers/runtimeAdapters/types";
import { getAiProviderModelReasoningMetadata } from "@/services/ai/providers/metadata";

export const zhipuAdapter: AiRuntimeAdapter = {
  providerId: "zhipu",
  createSdkProvider: (config) =>
    createZhipu({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    }),

  getReasoningCapability: ({ modelId }) =>
    getAiProviderModelReasoningMetadata("zhipu", modelId),

  resolveReasoning: (request) => {
    const capability = getAiProviderModelReasoningMetadata(
      "zhipu",
      request.modelId,
    );
    if (!capability.supported) {
      return createNoReasoningResolution({
        preference: request.preference,
        capability,
      });
    }

    const level = selectReasoningLevel(capability, request.preference.level);
    const enabled = level !== "none";
    return {
      capability,
      effectivePreference: {
        ...request.preference,
        level,
        displayPolicy: enabled ? request.preference.displayPolicy : "hidden",
      },
      callOptions: {
        providerOptions: {
          zhipu: {
            thinking: { type: enabled ? "enabled" : "disabled" },
          },
        },
      },
      replayPolicy: "none",
    };
  },
};
