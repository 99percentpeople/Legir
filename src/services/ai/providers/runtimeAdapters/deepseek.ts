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

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

const getDeepSeekReasoningCapability = (modelId: string) =>
  getAiProviderModelReasoningMetadata("deepseek", modelId);

export const deepseekAdapter: AiRuntimeAdapter = {
  providerId: "deepseek",

  createSdkProvider: (config) =>
    createOpenAiCompatibleChatOnlyProvider(config, {
      defaultBaseUrl: DEFAULT_DEEPSEEK_BASE_URL,
      providerName: "deepseek.chat",
      userAgentSuffix: "legir/deepseek-openai-compatible",
    }),

  getReasoningCapability: ({ modelId }) =>
    getDeepSeekReasoningCapability(modelId),

  resolveReasoning: (request) => {
    const capability = getDeepSeekReasoningCapability(request.modelId);
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
          deepseek: {
            thinking: { type: enabled ? "enabled" : "disabled" },
          },
        },
      },
      replayPolicy: enabled ? "tool-calls" : "none",
    };
  },

  validateMessages: (messages, request) => {
    validateReasoningBeforeToolCalls(messages, request, "DeepSeek");
  },
};
