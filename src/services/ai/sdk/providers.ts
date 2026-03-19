import { createProviderRegistry, type ProviderRegistryProvider } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { ProviderV3 } from "@ai-sdk/provider";

import {
  AI_PROVIDER_SPECS,
  getAiProviderSpec,
} from "@/services/ai/sdk/providerCatalog";
import type { AppOptions } from "@/types";
import type {
  AiSdkProviderConfig,
  AiSdkProviderId,
} from "@/services/ai/sdk/types";

export { AI_PROVIDER_LABELS } from "@/services/ai/sdk/providerCatalog";

export const normalizeOptionalText = (value: string | undefined) =>
  value?.trim() || "";

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
  const apiKey = normalizeOptionalText(options.llm[providerId].apiKey);
  if (!apiKey) return null;

  const baseURL = getProviderBaseUrl(options, providerId, spec);
  return {
    providerId,
    label: spec.label,
    backendKind: resolveBackendKind(options, providerId, spec),
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

  for (const config of getConfiguredAiSdkProviders(options)) {
    if (config.backendKind === "google") {
      providers[config.providerId] = createGoogleGenerativeAI({
        name: config.providerId,
        apiKey: config.apiKey,
      });
      continue;
    }

    if (config.backendKind === "deepseek") {
      providers[config.providerId] = createDeepSeek({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      });
      continue;
    }

    if (config.backendKind === "openai") {
      providers[config.providerId] = createOpenAI({
        name: config.providerId,
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      });
      continue;
    }

    if (config.backendKind === "openrouter") {
      providers[config.providerId] = createOpenRouter({
        apiKey: config.apiKey,
        compatibility: "strict",
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      });
      continue;
    }

    providers[config.providerId] = createOpenAICompatible({
      name: config.providerId,
      apiKey: config.apiKey,
      baseURL: config.baseURL || "https://api.openai.com/v1",
      supportsStructuredOutputs: true,
    });
  }

  return providers;
};

export const createAiSdkProviderRegistry = (options: AppOptions) => {
  return createProviderRegistry(
    createAiSdkProviders(options),
  ) as ProviderRegistryProvider<Record<string, ProviderV3>>;
};
