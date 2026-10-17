import type { AiRuntimeAdapter } from "./types";
import { createCatalogReasoningAdapter } from "./catalogReasoning";
import {
  createOpenAiCompatibleChatOnlyProvider,
  validateReasoningBeforeToolCalls,
} from "./openAiCompatibleChat";

export const deepseekAdapter: AiRuntimeAdapter = {
  providerId: "deepseek",
  ...createCatalogReasoningAdapter("deepseek"),
  createSdkProvider: (config) =>
    createOpenAiCompatibleChatOnlyProvider(config, {
      defaultBaseUrl: "https://api.deepseek.com/v1",
      providerName: "deepseek.chat",
      userAgentSuffix: "legir/deepseek-openai-compatible",
    }),
  validateMessages: (messages, request) => {
    validateReasoningBeforeToolCalls(messages, request, "DeepSeek");
  },
};
