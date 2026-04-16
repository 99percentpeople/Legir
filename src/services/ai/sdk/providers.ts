import { createProviderRegistry, type ProviderRegistryProvider } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { ProviderV3 } from "@ai-sdk/provider";
import { createMinimaxOpenAI } from "vercel-minimax-ai-provider";
import { createZhipu } from "zhipu-ai-provider";

import {
  AI_PROVIDER_SPECS,
  getAiProviderSelectedApiOption,
  getAiProviderSpec,
} from "@/services/ai/sdk/providerCatalog";
import { createApiProxyFetch } from "@/services/platform/apiProxy";
import type { AppOptions } from "@/types";
import type {
  AiSdkProviderConfig,
  AiSdkProviderId,
} from "@/services/ai/sdk/types";

export { AI_PROVIDER_LABELS } from "@/services/ai/sdk/providerCatalog";

export const normalizeOptionalText = (value: string | undefined) =>
  value?.trim() || "";

export const isAiSdkProviderEnabled = (
  options: AppOptions,
  providerId: AiSdkProviderId,
) => options.llm[providerId].enabled !== false;

export const normalizeBaseUrl = (value: string | undefined) => {
  const trimmed = normalizeOptionalText(value);
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
};

export const isOfficialOpenAiBaseUrl = (value: string) => {
  if (!value) return true;

  try {
    const host = new URL(value).host.toLowerCase();
    return host === "api.openai.com";
  } catch {
    return false;
  }
};

const getProviderBaseUrl = (
  options: AppOptions,
  providerId: AiSdkProviderId,
  spec = getAiProviderSpec(providerId),
) => {
  const configured = normalizeBaseUrl(options.llm[providerId].apiUrl);
  return configured || normalizeBaseUrl(spec.defaultBaseUrl);
};

const resolveBackendKind = (
  options: AppOptions,
  providerId: AiSdkProviderId,
  spec = getAiProviderSpec(providerId),
) => {
  const selectedApiOption = getAiProviderSelectedApiOption(
    providerId,
    options.llm[providerId].apiOptionId,
  );
  if (selectedApiOption) {
    return selectedApiOption.backendKind;
  }

  if (providerId !== "openai") {
    return spec.backendKind;
  }

  const baseURL = getProviderBaseUrl(options, providerId, spec);
  return baseURL && !isOfficialOpenAiBaseUrl(baseURL)
    ? "openai-compatible"
    : "openai";
};

const getProviderConfig = (
  options: AppOptions,
  providerId: AiSdkProviderId,
): AiSdkProviderConfig | null => {
  const spec = getAiProviderSpec(providerId);
  if (!isAiSdkProviderEnabled(options, providerId)) return null;
  const apiKey = normalizeOptionalText(options.llm[providerId].apiKey);
  if (!apiKey) return null;

  const selectedApiOption = getAiProviderSelectedApiOption(
    providerId,
    options.llm[providerId].apiOptionId,
  );
  const configuredBaseUrl = normalizeBaseUrl(options.llm[providerId].apiUrl);
  const baseURL =
    configuredBaseUrl ||
    normalizeBaseUrl(selectedApiOption?.defaultBaseUrl || spec.defaultBaseUrl);

  return {
    providerId,
    label: spec.label,
    backendKind: resolveBackendKind(options, providerId, spec),
    apiOptionId: selectedApiOption?.id,
    apiKey,
    baseURL: baseURL || undefined,
  };
};

export const getConfiguredAiSdkProviders = (options: AppOptions) =>
  AI_PROVIDER_SPECS.map((spec) => getProviderConfig(options, spec.id)).filter(
    Boolean,
  ) as AiSdkProviderConfig[];

export const getConfiguredAiSdkProvider = (
  options: AppOptions,
  providerId: AiSdkProviderId,
) =>
  getConfiguredAiSdkProviders(options).find(
    (provider) => provider.providerId === providerId,
  ) || null;

export const createAiSdkProviders = (options: AppOptions) => {
  const providers: Record<string, ProviderV3> = {};
  const proxyFetch = createApiProxyFetch(options);

  for (const config of getConfiguredAiSdkProviders(options)) {
    if (config.backendKind === "google") {
      providers[config.providerId] = createGoogleGenerativeAI({
        name: config.providerId,
        apiKey: config.apiKey,
        fetch: proxyFetch,
      });
      continue;
    }

    if (config.backendKind === "deepseek") {
      providers[config.providerId] = createDeepSeek({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        fetch: proxyFetch,
      });
      continue;
    }

    if (config.backendKind === "anthropic") {
      providers[config.providerId] = createAnthropic({
        name: config.providerId,
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        fetch: proxyFetch,
      });
      continue;
    }

    if (config.backendKind === "minimax-anthropic") {
      providers[config.providerId] = createAnthropic({
        name: config.providerId,
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        fetch: proxyFetch,
      });
      continue;
    }

    if (config.backendKind === "minimax-openai") {
      providers[config.providerId] = createMinimaxOpenAI({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        fetch: proxyFetch,
      });
      continue;
    }

    if (config.backendKind === "zhipu") {
      providers[config.providerId] = createZhipu({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        fetch: proxyFetch,
      });
      continue;
    }

    if (config.backendKind === "openai") {
      providers[config.providerId] = createOpenAI({
        name: config.providerId,
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        fetch: proxyFetch,
      });
      continue;
    }

    if (config.backendKind === "openrouter") {
      providers[config.providerId] = createOpenRouter({
        apiKey: config.apiKey,
        compatibility: "strict",
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        fetch: proxyFetch,
      });
      continue;
    }

    if (config.backendKind === "groq") {
      providers[config.providerId] = createGroq({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        fetch: proxyFetch,
      });
      continue;
    }

    if (config.backendKind === "xai") {
      providers[config.providerId] = createXai({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        fetch: proxyFetch,
      });
      continue;
    }

    providers[config.providerId] = createOpenAICompatible({
      name: config.providerId,
      apiKey: config.apiKey,
      baseURL: config.baseURL || "https://api.openai.com/v1",
      supportsStructuredOutputs: true,
      fetch: proxyFetch,
    });
  }

  return providers;
};

export const createAiSdkProviderRegistry = (options: AppOptions) => {
  return createProviderRegistry(
    createAiSdkProviders(options),
  ) as ProviderRegistryProvider<Record<string, ProviderV3>>;
};
