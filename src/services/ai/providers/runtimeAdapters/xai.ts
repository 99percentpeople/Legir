import { createBasicRuntimeAdapter } from "@/services/ai/providers/runtimeAdapters/shared";

export const xaiAdapter = createBasicRuntimeAdapter({
  providerId: "xai",
  createSdkProvider: async (config) => {
    const { createXai } = await import("@ai-sdk/xai");
    return createXai({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    });
  },
});
