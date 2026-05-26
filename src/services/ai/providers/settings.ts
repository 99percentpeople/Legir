import {
  AI_PROVIDER_SPECS,
  getAiProviderSelectedApiOption,
  getAiProviderSpec,
} from "@/services/ai/providers/catalog";
import type { AppOptions } from "@/types";
import type {
  AiSdkProviderConfig,
  AiSdkProviderId,
} from "@/services/ai/providers/types";

export { AI_PROVIDER_LABELS } from "@/services/ai/providers/catalog";

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

  return spec.backendKind;
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
  if (!baseURL && spec.allowCustomBaseUrl && !spec.defaultBaseUrl) {
    return null;
  }

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

export const isAiSdkProviderConfigured = (
  options: AppOptions,
  providerId: AiSdkProviderId,
) => getConfiguredAiSdkProvider(options, providerId) !== null;
