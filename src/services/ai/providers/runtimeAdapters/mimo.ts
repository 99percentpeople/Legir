import type { AiRuntimeAdapter } from "@/services/ai/providers/runtimeAdapters/types";
import {
  createNoReasoningResolution,
  selectReasoningLevel,
} from "@/services/ai/providers/runtimeAdapters/shared";
import {
  createOpenAiCompatibleChatOnlyProvider,
  validateReasoningBeforeToolCalls,
} from "@/services/ai/providers/runtimeAdapters/openAiCompatibleChat";
import { getAiProviderModelReasoningMetadata } from "@/services/ai/providers/metadata";

const DEFAULT_MIMO_BASE_URL = "https://api.xiaomimimo.com/v1";

export const mimoAdapter: AiRuntimeAdapter = {
  providerId: "xiaomi-mimo",

  createSdkProvider: (config) =>
    createOpenAiCompatibleChatOnlyProvider(config, {
      defaultBaseUrl: DEFAULT_MIMO_BASE_URL,
      providerName: "mimo.chat",
      userAgentSuffix: "legir/mimo-openai-compatible",
      supportsStructuredOutputs: true,
    }),

  getReasoningCapability: ({ modelId }) =>
    getAiProviderModelReasoningMetadata("xiaomi-mimo", modelId),

  resolveReasoning: (request) => {
    const capability = getAiProviderModelReasoningMetadata(
      "xiaomi-mimo",
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
      },
      callOptions: {
        providerOptions: {
          mimo: {
            thinking: { type: enabled ? "enabled" : "disabled" },
          },
        },
      },
      replayPolicy: enabled ? "tool-calls" : "none",
    };
  },

  validateMessages: (messages, request) => {
    validateReasoningBeforeToolCalls(messages, request, "MiMo");
  },
};
