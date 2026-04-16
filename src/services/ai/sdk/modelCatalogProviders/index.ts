import { AnthropicModelCatalogProvider } from "./anthropic";
import type { AiProviderId } from "@/services/ai/sdk/providerCatalog";
import type { AiSdkModelCatalogProvider } from "@/services/ai/sdk/types";
import { DeepSeekModelCatalogProvider } from "./deepseek";
import { GeminiModelCatalogProvider } from "./gemini";
import { GroqModelCatalogProvider } from "./groq";
import { MinimaxModelCatalogProvider } from "./minimax";
import { OpenAiModelCatalogProvider } from "./openAi";
import { OpenRouterModelCatalogProvider } from "./openRouter";
import { XaiModelCatalogProvider } from "./xai";
import { ZhipuModelCatalogProvider } from "./zhipu";

const modelCatalogProviders: AiSdkModelCatalogProvider[] = [
  new OpenAiModelCatalogProvider(),
  new AnthropicModelCatalogProvider(),
  new GeminiModelCatalogProvider(),
  new OpenRouterModelCatalogProvider(),
  new DeepSeekModelCatalogProvider(),
  new MinimaxModelCatalogProvider(),
  new ZhipuModelCatalogProvider(),
  new GroqModelCatalogProvider(),
  new XaiModelCatalogProvider(),
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
