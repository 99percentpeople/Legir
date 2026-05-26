import { createGroq } from "@ai-sdk/groq";

import { createBasicRuntimeAdapter } from "@/services/ai/providers/runtimeAdapters/shared";

export const groqAdapter = createBasicRuntimeAdapter({
  providerId: "groq",
  createSdkProvider: (config) =>
    createGroq({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    }),
});
