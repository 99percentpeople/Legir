import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { createBasicRuntimeAdapter } from "@/services/ai/providers/runtimeAdapters/shared";
import type { AiSdkProviderId } from "@/services/ai/providers/types";

export const createOpenAiCompatibleAdapter = (providerId: AiSdkProviderId) =>
  createBasicRuntimeAdapter({
    providerId,
    createSdkProvider: (config) => {
      if (!config.baseURL) {
        throw new Error(`${config.label} requires a custom API URL.`);
      }

      return createOpenAICompatible({
        name: config.providerId,
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        supportsStructuredOutputs: true,
        fetch: config.fetch,
      });
    },
  });
