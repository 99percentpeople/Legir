import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createZhipu } from "zhipu-ai-provider";

import { createConservativeRuntimeProfile } from "@/services/ai/providers/runtimeProfiles/shared";
import type { AiSdkProviderId } from "@/services/ai/providers/types";

export const createOpenAiCompatibleRuntimeProfile = (
  providerId: AiSdkProviderId,
) =>
  createConservativeRuntimeProfile({
    providerId,
    createProvider: (config) =>
      createOpenAICompatible({
        name: config.providerId,
        apiKey: config.apiKey,
        baseURL: config.baseURL || "https://api.openai.com/v1",
        supportsStructuredOutputs: true,
        fetch: config.fetch,
      }),
  });

export const openRouterRuntimeProfile = createConservativeRuntimeProfile({
  providerId: "openrouter",
  createProvider: (config) =>
    createOpenRouter({
      apiKey: config.apiKey,
      compatibility: "strict",
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    }),
});

export const groqRuntimeProfile = createConservativeRuntimeProfile({
  providerId: "groq",
  createProvider: (config) =>
    createGroq({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    }),
});

export const xaiRuntimeProfile = createConservativeRuntimeProfile({
  providerId: "xai",
  createProvider: (config) =>
    createXai({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    }),
});

export const zhipuRuntimeProfile = createConservativeRuntimeProfile({
  providerId: "zhipu",
  createProvider: (config) =>
    createZhipu({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    }),
});
