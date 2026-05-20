import { createDeepSeekProvider as createLegirDeepSeekProvider } from "@/services/ai/providers/deepseekProvider";
import type { AiSdkProviderConfig } from "@/services/ai/providers/types";
import type { AiProviderRuntimeProfile } from "@/services/ai/providers/runtimeProfiles/types";
import { createNoReasoningResolution } from "@/services/ai/providers/runtimeProfiles/shared";
import type { ModelMessage } from "ai";
import { getAiProviderModelReasoningMetadata } from "@/services/ai/providers/modelMetadata";

const createDeepSeekRuntimeProvider = (config: AiSdkProviderConfig) =>
  createLegirDeepSeekProvider({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    fetch: config.fetch,
  });

const getDeepSeekReasoningCapability = (modelId: string) =>
  getAiProviderModelReasoningMetadata("deepseek", modelId);

const hasToolCallPart = (message: ModelMessage) =>
  message.role === "assistant" &&
  Array.isArray(message.content) &&
  message.content.some((part) => part.type === "tool-call");

const hasReasoningPart = (message: ModelMessage) =>
  message.role === "assistant" &&
  Array.isArray(message.content) &&
  message.content.some(
    (part) =>
      part.type === "reasoning" &&
      typeof part.text === "string" &&
      part.text.trim(),
  );

export const deepseekRuntimeProfile: AiProviderRuntimeProfile = {
  providerId: "deepseek",

  createProvider: createDeepSeekRuntimeProvider,

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

    const enabled = request.preference.mode !== "off";
    return {
      capability,
      effectivePreference: {
        ...request.preference,
        mode: enabled ? "on" : "off",
        effort: "auto",
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
    if (request.reasoning.replayPolicy !== "tool-calls") return;

    const missingReasoning = messages.some(
      (message) => hasToolCallPart(message) && !hasReasoningPart(message),
    );
    if (!missingReasoning) return;

    throw new Error(
      "DeepSeek thinking mode requires reasoning content before assistant tool calls.",
    );
  },
};
