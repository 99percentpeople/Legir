import type { ProviderV3 } from "@ai-sdk/provider";

import {
  AI_PROVIDER_IDS,
  getAiProviderSpec,
  type AiProviderId,
} from "@/services/ai/providers/catalog";
import { AnthropicModelCatalogProvider } from "@/services/ai/providers/modelCatalog/anthropic";
import { GeminiModelCatalogProvider } from "@/services/ai/providers/modelCatalog/gemini";
import { MinimaxModelCatalogProvider } from "@/services/ai/providers/modelCatalog/minimax";
import { OpenAiCompatibleModelCatalogProvider } from "@/services/ai/providers/modelCatalog/openAiCompatible";
import { OpenRouterModelCatalogProvider } from "@/services/ai/providers/modelCatalog/openRouter";
import { XaiModelCatalogProvider } from "@/services/ai/providers/modelCatalog/xai";
import { XiaomiMimoModelCatalogProvider } from "@/services/ai/providers/modelCatalog/xiaomiMimo";
import {
  anthropicAdapter,
  anthropicCompatibleAdapter,
  createAnthropicCompatibleAdapter,
  createOpenAiCompatibleAdapter,
  deepseekAdapter,
  geminiAdapter,
  groqAdapter,
  mimoAdapter,
  openAiAdapter,
  openRouterAdapter,
  xaiAdapter,
  zhipuAdapter,
} from "@/services/ai/providers/runtimeAdapters";
import type { AiRuntimeAdapter } from "@/services/ai/providers/runtimeAdapters";
import type {
  AiProviderDefinition,
  AiSdkModelCatalogProvider,
  AiSdkProviderConfig,
} from "@/services/ai/providers/types";

const openAiCompatibleAdapters = new Map<string, AiRuntimeAdapter>();
const anthropicCompatibleAdapters = new Map<string, AiRuntimeAdapter>();

const getOpenAiCompatibleAdapter = (providerId: AiProviderId) => {
  const existing = openAiCompatibleAdapters.get(providerId);
  if (existing) return existing;
  const adapter = createOpenAiCompatibleAdapter(providerId);
  openAiCompatibleAdapters.set(providerId, adapter);
  return adapter;
};

const getAnthropicCompatibleAdapter = (
  providerId: AiProviderId,
  options: { authMode?: "api-key" | "bearer" } = {},
) => {
  const cacheKey = `${providerId}:${options.authMode ?? "api-key"}`;
  const existing = anthropicCompatibleAdapters.get(cacheKey);
  if (existing) return existing;
  const adapter = createAnthropicCompatibleAdapter(providerId, options);
  anthropicCompatibleAdapters.set(cacheKey, adapter);
  return adapter;
};

const staticAdapter = (adapter: AiRuntimeAdapter) => () => adapter;

const defineProvider = (
  providerId: AiProviderId,
  modelCatalogProvider: AiSdkModelCatalogProvider,
  getRuntimeAdapter: AiProviderDefinition["getRuntimeAdapter"],
): AiProviderDefinition => ({
  id: providerId,
  spec: getAiProviderSpec(providerId),
  modelCatalogProvider,
  getRuntimeAdapter,
});

export const AI_PROVIDER_DEFINITIONS = [
  defineProvider(
    "openai",
    new OpenAiCompatibleModelCatalogProvider("openai"),
    staticAdapter(openAiAdapter),
  ),
  defineProvider(
    "openai-compatible",
    new OpenAiCompatibleModelCatalogProvider("openai-compatible"),
    staticAdapter(getOpenAiCompatibleAdapter("openai-compatible")),
  ),
  defineProvider(
    "anthropic",
    new AnthropicModelCatalogProvider(),
    staticAdapter(anthropicAdapter),
  ),
  defineProvider(
    "anthropic-compatible",
    new AnthropicModelCatalogProvider("anthropic-compatible"),
    staticAdapter(anthropicCompatibleAdapter),
  ),
  defineProvider(
    "xiaomi-mimo",
    new XiaomiMimoModelCatalogProvider(),
    (config) =>
      config.backendKind === "anthropic-compatible"
        ? getAnthropicCompatibleAdapter("xiaomi-mimo", { authMode: "bearer" })
        : mimoAdapter,
  ),
  defineProvider(
    "gemini",
    new GeminiModelCatalogProvider(),
    staticAdapter(geminiAdapter),
  ),
  defineProvider(
    "openrouter",
    new OpenRouterModelCatalogProvider(),
    staticAdapter(openRouterAdapter),
  ),
  defineProvider(
    "deepseek",
    new OpenAiCompatibleModelCatalogProvider("deepseek"),
    staticAdapter(deepseekAdapter),
  ),
  defineProvider("minimax", new MinimaxModelCatalogProvider(), (config) =>
    config.backendKind === "openai-compatible"
      ? getOpenAiCompatibleAdapter("minimax")
      : getAnthropicCompatibleAdapter("minimax"),
  ),
  defineProvider(
    "zhipu",
    new OpenAiCompatibleModelCatalogProvider("zhipu"),
    staticAdapter(zhipuAdapter),
  ),
  defineProvider(
    "groq",
    new OpenAiCompatibleModelCatalogProvider("groq"),
    staticAdapter(groqAdapter),
  ),
  defineProvider(
    "xai",
    new XaiModelCatalogProvider(),
    staticAdapter(xaiAdapter),
  ),
] satisfies readonly AiProviderDefinition[];

const AI_PROVIDER_DEFINITIONS_BY_ID = new Map(
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

export const getAiProviderDefinitions = () => AI_PROVIDER_DEFINITIONS;

export const getAiSdkModelCatalogProvider = (providerId: AiProviderId) =>
  getAiProviderDefinition(providerId).modelCatalogProvider;

export const getAiRuntimeAdapter = (config: AiSdkProviderConfig) =>
  getAiProviderDefinition(config.providerId).getRuntimeAdapter(config);

export const createAiSdkProvider = (config: AiSdkProviderConfig): ProviderV3 =>
  getAiRuntimeAdapter(config).createSdkProvider(config);
