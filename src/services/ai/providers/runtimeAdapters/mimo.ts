import type { AiRuntimeAdapter } from "./types";
import { createCatalogReasoningAdapter } from "./catalogReasoning";
import {
  createOpenAiCompatibleChatOnlyProvider,
  validateReasoningBeforeToolCalls,
} from "./openAiCompatibleChat";

export const mimoAdapter: AiRuntimeAdapter = {
  providerId: "xiaomi-mimo",
  ...createCatalogReasoningAdapter("mimo"),
  createSdkProvider: (config) =>
    createOpenAiCompatibleChatOnlyProvider(config, {
      defaultBaseUrl: "https://api.xiaomimimo.com/v1",
      providerName: "mimo.chat",
      userAgentSuffix: "legir/mimo-openai-compatible",
      supportsStructuredOutputs: true,
    }),
  validateMessages: (messages, request) => {
    validateReasoningBeforeToolCalls(messages, request, "MiMo");
  },
};
