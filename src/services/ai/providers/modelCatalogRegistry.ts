import {
  AI_PROVIDER_IDS,
  type AiProviderId,
} from "@/services/ai/providers/catalog";
import { AnthropicModelCatalogProvider } from "@/services/ai/providers/modelCatalog/anthropic";
import { GeminiModelCatalogProvider } from "@/services/ai/providers/modelCatalog/gemini";
import { MinimaxModelCatalogProvider } from "@/services/ai/providers/modelCatalog/minimax";
import { OpenAiCompatibleModelCatalogProvider } from "@/services/ai/providers/modelCatalog/openAiCompatible";
import { OpenRouterModelCatalogProvider } from "@/services/ai/providers/modelCatalog/openRouter";
import { XaiModelCatalogProvider } from "@/services/ai/providers/modelCatalog/xai";
import { XiaomiMimoModelCatalogProvider } from "@/services/ai/providers/modelCatalog/xiaomiMimo";
import type { AiSdkModelCatalogProvider } from "@/services/ai/providers/types";

const modelCatalogProviders = new Map<AiProviderId, AiSdkModelCatalogProvider>([
  ["openai", new OpenAiCompatibleModelCatalogProvider("openai")],
  [
    "openai-compatible",
    new OpenAiCompatibleModelCatalogProvider("openai-compatible"),
  ],
  ["anthropic", new AnthropicModelCatalogProvider()],
  [
    "anthropic-compatible",
    new AnthropicModelCatalogProvider("anthropic-compatible"),
  ],
  ["xiaomi-mimo", new XiaomiMimoModelCatalogProvider()],
  ["gemini", new GeminiModelCatalogProvider()],
  ["openrouter", new OpenRouterModelCatalogProvider()],
  ["deepseek", new OpenAiCompatibleModelCatalogProvider("deepseek")],
  ["minimax", new MinimaxModelCatalogProvider()],
  ["zhipu", new OpenAiCompatibleModelCatalogProvider("zhipu")],
  ["groq", new OpenAiCompatibleModelCatalogProvider("groq")],
  ["xai", new XaiModelCatalogProvider()],
]);

const missingProviderIds = AI_PROVIDER_IDS.filter(
  (providerId) => !modelCatalogProviders.has(providerId),
);
if (missingProviderIds.length > 0) {
  throw new Error(
    `Missing AI model catalog providers: ${missingProviderIds.join(", ")}`,
  );
}

export const getAiSdkModelCatalogProvider = (providerId: AiProviderId) => {
  const provider = modelCatalogProviders.get(providerId);
  if (!provider) {
    throw new Error(
      `No AI model catalog provider registered for ${providerId}.`,
    );
  }
  return provider;
};
