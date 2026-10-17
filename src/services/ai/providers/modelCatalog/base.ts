import { isTextGenerationModelId } from "../catalog";
import type { AppOptions, LLMModelCapabilities } from "@/types";
import { createAiDiscoveredModel, getCatalogModels } from "../models";
import { resolveAiProviderModelMetadata } from "../metadata";
import { getAiConnectionConfig, getConfiguredAiSdkProvider } from "../settings";
import { initializeModelsDev } from "../modelsDev";
import { fetchWithApiProxy } from "@/services/platform/apiProxy";
import type {
  AiSdkDiscoveredModel,
  AiSdkModelCatalogProvider,
  AiSdkModelCatalogProviderRequest,
  AiSdkModelCatalogProviderTaskRequest,
  AiSdkProviderConfig,
} from "../types";

export const MODEL_CACHE_TTL_MS = 60 * 60 * 1000;
export const getConnectionCacheKey = (options: AppOptions, id: string) => {
  // This identifier is only for invalidation, never authentication. Do not retain key plaintext in caches.
  const config = getAiConnectionConfig(options, id);
  const text = JSON.stringify([
    config && { ...config, label: undefined },
    options.apiProxy,
  ]);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16);
};
export const modelMatchesTaskKind = (
  capabilities: LLMModelCapabilities,
  kind: AiSdkModelCatalogProviderTaskRequest["kind"],
) =>
  kind === "vision"
    ? capabilities.supportsImageInput
    : kind === "chat"
      ? capabilities.supportsToolCalls
      : capabilities.inputModalities.includes("text");

export class ConnectionModelCatalogProvider implements AiSdkModelCatalogProvider {
  constructor(readonly providerId: string) {}

  private normalize(
    models: AiSdkDiscoveredModel[],
    config: AiSdkProviderConfig,
  ) {
    const seen = new Set<string>();
    return models.flatMap((model) => {
      if (!model.id || seen.has(model.id)) return [];
      seen.add(model.id);
      const metadata = resolveAiProviderModelMetadata(
        config.catalogId || "",
        model.id,
      );
      return [
        createAiDiscoveredModel({
          modelId: model.id,
          label: model.label,
          rank: model.rank,
          // Explicit endpoint facts win; catalog facts fill fields absent from the endpoint.
          inputModalities:
            model.inputModalities ?? metadata.capabilities?.inputModalities,
          outputModalities:
            model.outputModalities ?? metadata.capabilities?.outputModalities,
          supportsToolCalls:
            model.supportsToolCalls ?? metadata.capabilities?.supportsToolCalls,
          supportsImageToolResults:
            model.supportsImageToolResults ??
            metadata.capabilities?.supportsImageToolResults,
          contextWindowTokens:
            model.contextWindowTokens ?? metadata.contextWindowTokens,
          capabilities: model.capabilities,
        }),
      ];
    });
  }

  getModelsForTask(options: AiSdkModelCatalogProviderTaskRequest) {
    const config = getConfiguredAiSdkProvider(
      options.appOptions,
      this.providerId,
    );
    if (!config) return [];
    const cached = options.modelCache[this.providerId];
    const validCache =
      cached &&
      (!cached.configurationKey ||
        cached.configurationKey ===
          getConnectionCacheKey(options.appOptions, this.providerId));
    const source =
      validCache && cached.fetchedAt !== undefined
        ? cached.models
        : cached?.models.length && validCache
          ? cached.models
          : getCatalogModels(config.catalogId || "");
    return this.normalize(source, config).filter((model) =>
      modelMatchesTaskKind(model.capabilities, options.kind),
    );
  }

  async checkConfig(options: AiSdkModelCatalogProviderRequest) {
    await this.fetchModels(options);
  }

  async fetchModels(options: AiSdkModelCatalogProviderRequest) {
    await initializeModelsDev();
    const config = getConfiguredAiSdkProvider(
      options.appOptions,
      this.providerId,
    );
    if (!config?.baseURL)
      throw new Error(
        "AI connection requires an enabled configuration, URL and credentials.",
      );
    const models: AiSdkDiscoveredModel[] = [];
    const headers: Record<string, string> = {};
    const anthropic =
      config.backendKind === "anthropic" ||
      config.backendKind === "anthropic-compatible";
    const google = config.backendKind === "google";
    if (anthropic) {
      headers[config.authMode === "bearer" ? "Authorization" : "x-api-key"] =
        config.authMode === "bearer"
          ? `Bearer ${config.apiKey}`
          : config.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
    } else if (google) {
      headers["x-goog-api-key"] = config.apiKey;
    } else if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    if (config.authMode === "none") {
      delete headers.Authorization;
      delete headers["x-api-key"];
      delete headers["x-goog-api-key"];
    }
    let cursor = "";
    const cursors = new Set<string>();
    do {
      const url = new URL(
        `${config.baseURL}/${config.backendKind === "xai" ? "language-models" : "models"}`,
      );
      if (anthropic) {
        url.searchParams.set("limit", "1000");
        if (cursor) url.searchParams.set("after_id", cursor);
      }
      if (google) {
        url.searchParams.set("pageSize", "1000");
        if (cursor) url.searchParams.set("pageToken", cursor);
      }
      const response = await fetchWithApiProxy(options.appOptions, url, {
        headers,
        signal: options.signal || AbortSignal.timeout(20_000),
      });
      if ([404, 405].includes(response.status))
        return this.normalize(getCatalogModels(config.catalogId || ""), config);
      if (!response.ok)
        throw new Error(`Models request failed (${response.status}).`);
      const json = await response.json();
      const items =
        google || config.backendKind === "xai" ? json.models : json.data;
      if (!Array.isArray(items)) throw new Error("Invalid models response.");
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        if (
          google &&
          Array.isArray(item.supportedGenerationMethods) &&
          !item.supportedGenerationMethods.includes("generateContent")
        )
          continue;
        const id = google
          ? typeof item.name === "string"
            ? item.name.replace(/^models\//, "")
            : ""
          : typeof item.id === "string"
            ? item.id
            : "";
        if (!id || !isTextGenerationModelId(id)) continue;
        const modalities = (value: unknown) =>
          Array.isArray(value) &&
          value.every((part) => typeof part === "string")
            ? (value as string[])
            : undefined;
        models.push({
          id,
          label: item.display_name || item.displayName || item.name || id,
          inputModalities: modalities(
            item.input_modalities || item.architecture?.input_modalities,
          ),
          outputModalities: modalities(
            item.output_modalities || item.architecture?.output_modalities,
          ),
          supportsToolCalls: Array.isArray(item.supported_parameters)
            ? item.supported_parameters.includes("tools")
            : undefined,
          contextWindowTokens:
            typeof item.context_length === "number"
              ? item.context_length
              : typeof item.inputTokenLimit === "number"
                ? item.inputTokenLimit
                : undefined,
        });
      }
      cursor =
        google && typeof json.nextPageToken === "string"
          ? json.nextPageToken
          : anthropic && json.has_more && typeof json.last_id === "string"
            ? json.last_id
            : "";
      if (cursor && cursors.has(cursor))
        throw new Error("Repeated models page cursor.");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return this.normalize(models, config);
  }
}
