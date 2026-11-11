import type { AiRuntimeProtocol } from "../catalog";
import type { AiSdkProviderConfig } from "../types";
import type { AiRuntimeAdapter } from "./types";
import {
  createOpenAiCompatibleChatOnlyProvider,
  validateReasoningBeforeToolCalls,
} from "./openAiCompatibleChat";

type RuntimeProtocol = Pick<
  AiRuntimeAdapter,
  "createSdkProvider" | "supportsImageToolResults" | "validateMessages"
>;

const sdkSettings = (config: AiSdkProviderConfig) => ({
  apiKey: config.apiKey,
  ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  fetch: config.fetch,
});

const reasoningChatProtocol = (
  label: string,
  options: Parameters<typeof createOpenAiCompatibleChatOnlyProvider>[1],
): RuntimeProtocol => ({
  createSdkProvider: (config) =>
    createOpenAiCompatibleChatOnlyProvider(config, options),
  validateMessages: (messages, request) =>
    validateReasoningBeforeToolCalls(messages, request, label),
});

// Only executable protocol differences live here. Provider/model lists come from
// the catalog, and SDK imports stay lazy until a connection is actually used.
export const runtimeProtocols: Record<AiRuntimeProtocol, RuntimeProtocol> = {
  openai: {
    supportsImageToolResults: true,
    createSdkProvider: async (config) => {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({ ...sdkSettings(config), name: config.providerId });
    },
  },
  "openai-compatible": {
    createSdkProvider: async (config) => {
      if (!config.baseURL)
        throw new Error(`${config.label} requires a custom API URL.`);
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      return createOpenAICompatible({
        ...sdkSettings(config),
        name: config.providerId,
        baseURL: config.baseURL,
        supportsStructuredOutputs: true,
      });
    },
  },
  anthropic: {
    supportsImageToolResults: true,
    createSdkProvider: async (config) => {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const { apiKey, ...settings } = sdkSettings(config);
      return createAnthropic({
        ...settings,
        name: config.providerId,
        ...(config.authMode === "bearer" ? { authToken: apiKey } : { apiKey }),
      });
    },
  },
  google: {
    supportsImageToolResults: true,
    createSdkProvider: async (config) => {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      return createGoogleGenerativeAI({
        ...sdkSettings(config),
        name: config.providerId,
      });
    },
  },
  groq: {
    createSdkProvider: async (config) => {
      const { createGroq } = await import("@ai-sdk/groq");
      return createGroq(sdkSettings(config));
    },
  },
  openrouter: {
    createSdkProvider: async (config) => {
      const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
      return createOpenRouter({
        ...sdkSettings(config),
        compatibility: "strict",
      });
    },
  },
  xai: {
    supportsImageToolResults: true,
    createSdkProvider: async (config) => {
      const { createXai } = await import("@ai-sdk/xai");
      return createXai(sdkSettings(config));
    },
  },
  zhipu: {
    createSdkProvider: async (config) => {
      const { createZhipu } = await import("zhipu-ai-provider");
      return createZhipu(sdkSettings(config));
    },
  },
  deepseek: reasoningChatProtocol("DeepSeek", {
    defaultBaseUrl: "https://api.deepseek.com/v1",
    providerName: "deepseek.chat",
    userAgentSuffix: "legir/deepseek-openai-compatible",
  }),
  mimo: reasoningChatProtocol("MiMo", {
    defaultBaseUrl: "https://api.xiaomimimo.com/v1",
    providerName: "mimo.chat",
    userAgentSuffix: "legir/mimo-openai-compatible",
    supportsStructuredOutputs: true,
  }),
};
