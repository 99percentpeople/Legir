import type { AiProviderId } from "@/services/ai/sdk/providerCatalog";
import type { AiSdkModelCatalogProvider } from "@/services/ai/sdk/types";
import { DeepSeekModelCatalogProvider } from "./deepseek";
import { GeminiModelCatalogProvider } from "./gemini";
import { OpenAiCompatibleModelCatalogProvider } from "./openAiCompatible";
import { OpenAiModelCatalogProvider } from "./openAi";
import { OpenRouterModelCatalogProvider } from "./openRouter";

const modelCatalogProviders: AiSdkModelCatalogProvider[] = [
  new OpenAiModelCatalogProvider(),
  new GeminiModelCatalogProvider(),
  new OpenRouterModelCatalogProvider(),
  new DeepSeekModelCatalogProvider(),
  new OpenAiCompatibleModelCatalogProvider("groq"),
  new OpenAiCompatibleModelCatalogProvider("xai"),
];

const providersById = new Map(
  modelCatalogProviders.map((provider) => [provider.providerId, provider]),
);

export const getAiSdkModelCatalogProvider = (providerId: AiProviderId) => {
  const provider = providersById.get(providerId);
  if (!provider) {
    throw new Error(`No model catalog provider registered for ${providerId}.`);
  }
  return provider;
};
