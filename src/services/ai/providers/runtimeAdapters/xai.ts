import { createXai } from "@ai-sdk/xai";

import { createBasicRuntimeAdapter } from "@/services/ai/providers/runtimeAdapters/shared";

export const xaiAdapter = createBasicRuntimeAdapter({
  providerId: "xai",
  createSdkProvider: (config) =>
    createXai({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    }),
});
