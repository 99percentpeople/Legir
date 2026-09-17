import { createBasicRuntimeAdapter } from "@/services/ai/providers/runtimeAdapters/shared";

export const groqAdapter = createBasicRuntimeAdapter({
  providerId: "groq",
  createSdkProvider: async (config) => {
    const { createGroq } = await import("@ai-sdk/groq");
    return createGroq({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      fetch: config.fetch,
    });
  },
});
