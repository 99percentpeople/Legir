import { createMinimaxOpenAI } from "vercel-minimax-ai-provider";

import { createAnthropicRuntimeProfile } from "@/services/ai/providers/runtimeProfiles/anthropic";
import { createConservativeRuntimeProfile } from "@/services/ai/providers/runtimeProfiles/shared";

export const minimaxAnthropicRuntimeProfile = createAnthropicRuntimeProfile(
  "minimax",
  {
    textExposure: "raw",
  },
);

export const minimaxOpenAiRuntimeProfile = createConservativeRuntimeProfile({
  providerId: "minimax",
  createProvider: (config) =>
    createMinimaxOpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    }),
});
