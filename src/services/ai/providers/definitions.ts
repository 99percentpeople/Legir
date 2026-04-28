import { AnthropicModelCatalogProvider } from "@/services/ai/providers/modelCatalogProviders/anthropic";
import { GeminiModelCatalogProvider } from "@/services/ai/providers/modelCatalogProviders/gemini";
import { MinimaxModelCatalogProvider } from "@/services/ai/providers/modelCatalogProviders/minimax";
import { OpenAiCompatibleModelCatalogProvider } from "@/services/ai/providers/modelCatalogProviders/openAiCompatible";
import { OpenRouterModelCatalogProvider } from "@/services/ai/providers/modelCatalogProviders/openRouter";
import { XaiModelCatalogProvider } from "@/services/ai/providers/modelCatalogProviders/xai";
import { ZhipuModelCatalogProvider } from "@/services/ai/providers/modelCatalogProviders/zhipu";
import {
  AI_PROVIDER_IDS,
  getAiProviderSpec,
  type AiProviderId,
} from "@/services/ai/providers/catalog";
import type {
  AiProviderDefinition,
  AiSdkModelCatalogProvider,
} from "@/services/ai/providers/types";

const defineAiProvider = (
  providerId: AiProviderId,
  modelCatalogProvider: AiSdkModelCatalogProvider,
): AiProviderDefinition => ({
  id: providerId,
  spec: getAiProviderSpec(providerId),
  modelCatalogProvider,
});

export const AI_PROVIDER_DEFINITIONS = [
  defineAiProvider(
    "openai",
    new OpenAiCompatibleModelCatalogProvider("openai"),
  ),
  defineAiProvider("anthropic", new AnthropicModelCatalogProvider()),
  defineAiProvider("gemini", new GeminiModelCatalogProvider()),
  defineAiProvider("openrouter", new OpenRouterModelCatalogProvider()),
  defineAiProvider(
    "deepseek",
    new OpenAiCompatibleModelCatalogProvider("deepseek"),
  ),
  defineAiProvider("minimax", new MinimaxModelCatalogProvider()),
  defineAiProvider("zhipu", new ZhipuModelCatalogProvider()),
  defineAiProvider(
    "groq",
    new OpenAiCompatibleModelCatalogProvider("groq", {
      extraNonToolPatterns: [/(?:^|[-_/])audio(?:[-_/]|$)/],
    }),
  ),
  defineAiProvider("xai", new XaiModelCatalogProvider()),
] satisfies readonly AiProviderDefinition[];

export const AI_PROVIDER_DEFINITIONS_BY_ID = new Map(
  AI_PROVIDER_DEFINITIONS.map((definition) => [definition.id, definition]),
);

const missingProviderDefinitions = AI_PROVIDER_IDS.filter(
  (providerId) => !AI_PROVIDER_DEFINITIONS_BY_ID.has(providerId),
);
if (missingProviderDefinitions.length > 0) {
  throw new Error(
    `Missing AI provider definitions: ${missingProviderDefinitions.join(", ")}`,
  );
}

export const getAiProviderDefinition = (providerId: AiProviderId) => {
  const definition = AI_PROVIDER_DEFINITIONS_BY_ID.get(providerId);
  if (!definition) {
    throw new Error(`No AI provider definition registered for ${providerId}.`);
  }
  return definition;
};
