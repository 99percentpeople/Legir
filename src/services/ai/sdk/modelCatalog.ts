import type { LLMModelOption } from "@/services/ai/types";
import {
  getAiProviderSpec,
  type AiProviderId,
} from "@/services/ai/sdk/providerCatalog";
import {
  getConfiguredAiSdkProvider,
  normalizeBaseUrl,
} from "@/services/ai/sdk/providers";
import { isSupportedGeminiToolCallingModelId } from "@/services/ai/utils/geminiModelSupport";
import type { AppOptions } from "@/types";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const GEMINI_MODELS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models";

const joinUrl = (baseUrl: string, path: string) =>
  `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const readErrorText = async (response: Response) => {
  const text = await response.text().catch(() => "");
  return text || response.statusText || "Request failed.";
};

const normalizeModelOptions = (
  models: Array<{ id: string; label?: string }>,
): LLMModelOption[] => {
  const seen = new Set<string>();
  return models
    .map((model) => ({
      id: model.id.trim(),
      label: (model.label || model.id).trim() || model.id.trim(),
    }))
    .filter((model) => !!model.id)
    .filter((model) => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
};

const fetchOpenAiStyleModels = async (options: {
  appOptions: AppOptions;
  providerId: AiProviderId;
  signal?: AbortSignal;
}) => {
  const config = getConfiguredAiSdkProvider(
    options.appOptions,
    options.providerId,
  );
  if (!config) {
    throw new Error(
      `Missing ${getAiProviderSpec(options.providerId).label} API key.`,
    );
  }

  const baseUrl = normalizeBaseUrl(config.baseURL || DEFAULT_OPENAI_BASE_URL);
  const response = await fetch(joinUrl(baseUrl, "/models"), {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = await readErrorText(response);
    throw new Error(
      `${getAiProviderSpec(options.providerId).label} models request failed (${response.status}): ${errorText}`,
    );
  }

  const json = (await response.json()) as {
    data?: Array<{ id?: string }>;
  };

  return normalizeModelOptions(
    (json.data || []).flatMap((item) =>
      typeof item.id === "string" ? [{ id: item.id }] : [],
    ),
  );
};

const normalizeGeminiModelId = (name: string) =>
  name.startsWith("models/") ? name.slice("models/".length) : name;

const fetchGeminiModels = async (options: {
  appOptions: AppOptions;
  signal?: AbortSignal;
}) => {
  const config = getConfiguredAiSdkProvider(options.appOptions, "gemini");
  if (!config) {
    throw new Error("Missing Gemini API key.");
  }

  const models: Array<{ id: string; label: string }> = [];
  let pageToken = "";

  do {
    const url = new URL(GEMINI_MODELS_ENDPOINT);
    url.searchParams.set("key", config.apiKey);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url.toString(), {
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await readErrorText(response);
      throw new Error(
        `Gemini models request failed (${response.status}): ${errorText}`,
      );
    }

    const json = (await response.json()) as {
      models?: Array<{
        name?: string;
        displayName?: string;
        supportedGenerationMethods?: string[];
      }>;
      nextPageToken?: string;
    };

    for (const item of json.models || []) {
      const name = typeof item.name === "string" ? item.name : "";
      if (!name) continue;
      const methods = Array.isArray(item.supportedGenerationMethods)
        ? item.supportedGenerationMethods
        : [];
      if (methods.length > 0 && !methods.includes("generateContent")) {
        continue;
      }
      const id = normalizeGeminiModelId(name);
      if (!isSupportedGeminiToolCallingModelId(id)) {
        continue;
      }

      models.push({
        id,
        label: item.displayName?.trim() || id,
      });
    }

    pageToken =
      typeof json.nextPageToken === "string" ? json.nextPageToken : "";
  } while (pageToken);
  return normalizeModelOptions(models);
};

export const isAiSdkProviderConfigured = (
  options: AppOptions,
  providerId: AiProviderId,
) => {
  return getConfiguredAiSdkProvider(options, providerId) !== null;
};

export const checkAiSdkProviderConfig = async (options: {
  appOptions: AppOptions;
  providerId: AiProviderId;
  signal?: AbortSignal;
}) => {
  const spec = getAiProviderSpec(options.providerId);
  if (spec.modelListMode === "google") {
    await fetchGeminiModels({
      appOptions: options.appOptions,
      signal: options.signal,
    });
    return;
  }

  await fetchOpenAiStyleModels(options);
};

export const fetchAiSdkProviderModels = async (options: {
  appOptions: AppOptions;
  providerId: AiProviderId;
  signal?: AbortSignal;
}) => {
  const spec = getAiProviderSpec(options.providerId);
  if (spec.modelListMode === "google") {
    return await fetchGeminiModels({
      appOptions: options.appOptions,
      signal: options.signal,
    });
  }

  return await fetchOpenAiStyleModels(options);
};

export const getAiSdkFallbackModelId = (options: {
  appOptions: AppOptions;
  providerId: AiProviderId;
}) => {
  void options.appOptions;
  return getAiProviderSpec(options.providerId).fallbackModelId || "";
};
