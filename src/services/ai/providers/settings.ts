import { runtimeProviderId } from "./catalog";
import {
  getAiConnectionAuthMode,
  getAiConnectionLabel,
  normalizeAiConnection,
} from "./connections";
import type { AppOptions } from "@/types";
import type { AiSdkProviderConfig, AiSdkProviderId } from "./types";

export const normalizeOptionalText = (value: string | undefined) =>
  value?.trim() || "";
export const normalizeBaseUrl = (value: string | undefined) =>
  normalizeOptionalText(value).replace(/\/+$/, "");
const isValidBaseUrl = (value: string | undefined) => {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};
export const isAiSdkProviderEnabled = (
  options: AppOptions,
  providerId: string,
) => !!options.llm[providerId] && options.llm[providerId].enabled !== false;
export const getAiConnectionConfig = (
  options: AppOptions,
  connectionId: string,
): AiSdkProviderConfig | null => {
  const saved = options.llm[connectionId];
  if (!saved) return null;
  const value = normalizeAiConnection(connectionId, saved);
  const authMode = getAiConnectionAuthMode(value);
  return {
    providerId: connectionId,
    catalogId: value.catalogId || "",
    runtimeProviderId: runtimeProviderId(
      value.catalogId || value.backendKind || "openai-compatible",
    ),
    label: getAiConnectionLabel(options.llm, connectionId),
    backendKind: value.backendKind!,
    apiOptionId: value.apiOptionId,
    authMode,
    apiKey: authMode === "none" ? "" : normalizeOptionalText(value.apiKey),
    baseURL: normalizeBaseUrl(value.apiUrl) || undefined,
  };
};
export const getConfiguredAiSdkProvider = (
  options: AppOptions,
  providerId: AiSdkProviderId,
): AiSdkProviderConfig | null => {
  const config = getAiConnectionConfig(options, providerId);
  if (
    !config ||
    !isAiSdkProviderEnabled(options, providerId) ||
    !isValidBaseUrl(config.baseURL)
  )
    return null;
  // A compatible local endpoint may intentionally have no API key.
  if (!config.apiKey && config.authMode !== "none") return null;
  return config;
};
export const getConfiguredAiSdkProviders = (options: AppOptions) =>
  Object.keys(options.llm).flatMap((id) => {
    const config = getConfiguredAiSdkProvider(options, id);
    return config ? [config] : [];
  });
export const isAiSdkProviderConfigured = (
  options: AppOptions,
  providerId: string,
) => getConfiguredAiSdkProvider(options, providerId) !== null;
