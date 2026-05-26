import type { LLMModelOption } from "@/services/ai/types";
import {
  createCustomModelCapabilities,
  modelSupportsInputModality,
} from "@/services/ai/providers/capabilities";
import {
  createAiDiscoveredModel,
  getCuratedAiProviderModels,
} from "@/services/ai/providers/models";
import { mergeModelCapabilitiesWithMetadata } from "@/services/ai/providers/metadata";
import {
  getAiProviderSpec,
  type AiProviderId,
} from "@/services/ai/providers/catalog";
import {
  getConfiguredAiSdkProvider,
  normalizeBaseUrl,
} from "@/services/ai/providers/settings";
import { fetchWithApiProxy } from "@/services/platform/apiProxy";
import { joinUrl } from "@/services/ai/providers/modelCatalog/shared";
import type {
  AiSdkModelCallOptions,
  AiSdkDiscoveredModel,
  AiSdkModelCatalogProvider,
  AiSdkModelCatalogProviderCallOptionsRequest,
  AiSdkModelCatalogProviderRequest,
  AiSdkModelCatalogProviderTaskRequest,
  AiSdkProviderConfig,
} from "@/services/ai/providers/types";
import type { LLMModelCapabilities } from "@/types";

const readErrorText = async (response: Response) => {
  const text = await response.text().catch(() => "");
  return text || response.statusText || "Request failed.";
};

type OpenAiCompatibleModelsResponse = {
  data?: Array<{ id?: string }>;
};

const OPENAI_COMPATIBLE_MODEL_FALLBACK_STATUSES = new Set([404, 405]);

const normalizeModelOptions = (
  providerId: AiProviderId,
  models: AiSdkDiscoveredModel[],
): LLMModelOption[] => {
  const seen = new Set<string>();

  return models
    .map((model) => {
      const discoveredModel = createAiDiscoveredModel({
        modelId: model.id,
        label: model.label,
        capabilities: model.capabilities,
        inputModalities: model.inputModalities,
        outputModalities: model.outputModalities,
        supportsToolCalls: model.supportsToolCalls,
        supportsImageToolResults: model.supportsImageToolResults,
        contextWindowTokens: model.contextWindowTokens,
      });
      return {
        id: discoveredModel.id,
        label:
          (discoveredModel.label || discoveredModel.id).trim() ||
          discoveredModel.id,
        capabilities: mergeModelCapabilitiesWithMetadata(
          providerId,
          discoveredModel.id,
          discoveredModel.capabilities,
        ),
      };
    })
    .filter((model) => !!model.id)
    .filter((model) => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
};

export const modelMatchesTaskKind = (
  capabilities: LLMModelCapabilities,
  kind: AiSdkModelCatalogProviderTaskRequest["kind"],
) => {
  if (kind === "vision") {
    return capabilities.supportsImageInput;
  }

  if (kind === "chat") {
    return capabilities.supportsToolCalls;
  }

  return modelSupportsInputModality(capabilities, "text");
};

export abstract class BaseAiSdkModelCatalogProvider implements AiSdkModelCatalogProvider {
  abstract readonly providerId: AiProviderId;

  abstract fetchModels(
    options: AiSdkModelCatalogProviderRequest,
  ): Promise<LLMModelOption[]>;

  getModelsForTask(options: AiSdkModelCatalogProviderTaskRequest) {
    return this.normalizeDiscoveredModels([
      ...this.getCuratedModels(options.appOptions),
      ...this.getCachedAndCustomModels(options),
    ]).filter((model) =>
      modelMatchesTaskKind(model.capabilities, options.kind),
    );
  }

  resolveCallOptions(
    _options: AiSdkModelCatalogProviderCallOptionsRequest,
  ): AiSdkModelCallOptions | undefined {
    return undefined;
  }

  async checkConfig(options: AiSdkModelCatalogProviderRequest) {
    await this.fetchModels(options);
  }

  protected getProviderSpec() {
    return getAiProviderSpec(this.providerId);
  }

  protected getConfiguredProviderConfig(
    appOptions: AiSdkModelCatalogProviderRequest["appOptions"],
  ) {
    return getConfiguredAiSdkProvider(appOptions, this.providerId);
  }

  protected getRequiredProviderConfig(
    appOptions: AiSdkModelCatalogProviderRequest["appOptions"],
  ) {
    const config = this.getConfiguredProviderConfig(appOptions);
    if (config) return config;

    throw new Error(`Missing ${this.getProviderSpec().label} API key.`);
  }

  protected getProviderBaseUrl(config: Pick<AiSdkProviderConfig, "baseURL">) {
    return normalizeBaseUrl(
      config.baseURL || this.getProviderSpec().defaultBaseUrl,
    );
  }

  protected async fetchWithProxy(
    options: AiSdkModelCatalogProviderRequest,
    input: RequestInfo | URL,
    init?: RequestInit,
  ) {
    return await fetchWithApiProxy(options.appOptions, input, {
      ...init,
      signal: init?.signal || options.signal,
    });
  }

  protected normalizeDiscoveredModels(models: AiSdkDiscoveredModel[]) {
    return normalizeModelOptions(this.providerId, models);
  }

  protected async fetchOpenAiCompatibleModels(options: {
    request: AiSdkModelCatalogProviderRequest;
    errorLabel: string;
    requireCuratedFallback?: boolean;
  }) {
    const config = this.getRequiredProviderConfig(options.request.appOptions);
    const curatedModels = this.getCuratedModels(options.request.appOptions);
    const response = await this.fetchWithProxy(
      options.request,
      joinUrl(this.getProviderBaseUrl(config), "/models"),
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      },
    );

    if (
      OPENAI_COMPATIBLE_MODEL_FALLBACK_STATUSES.has(response.status) &&
      (!options.requireCuratedFallback || curatedModels.length > 0)
    ) {
      return this.normalizeDiscoveredModels(curatedModels);
    }

    const json = await this.parseJsonOrThrow<OpenAiCompatibleModelsResponse>({
      response,
      errorLabel: options.errorLabel,
    });

    const discoveredModels = (json.data || []).flatMap((item) =>
      typeof item.id === "string" ? [{ id: item.id }] : [],
    );

    return this.normalizeDiscoveredModels(
      discoveredModels.length > 0
        ? [...curatedModels, ...discoveredModels]
        : curatedModels,
    );
  }

  protected getCuratedModels(
    appOptions: AiSdkModelCatalogProviderRequest["appOptions"],
  ) {
    const config = this.getConfiguredProviderConfig(appOptions);
    if (!config) return [];

    return getCuratedAiProviderModels({
      providerId: this.providerId,
      apiOptionId: config.apiOptionId,
      baseURL: this.getProviderBaseUrl(config),
    });
  }

  protected getCachedAndCustomModels(
    options: AiSdkModelCatalogProviderTaskRequest,
  ) {
    const fetchedModels = options.modelCache[this.providerId]?.models ?? [];
    const customModels = options.appOptions.llm[
      this.providerId
    ].customModels.map((model) => ({
      id: model.id,
      label: model.id,
      capabilities: createCustomModelCapabilities(model.capabilities),
    }));

    return [...fetchedModels, ...customModels];
  }

  protected async parseJsonOrThrow<T>(options: {
    response: Response;
    errorLabel: string;
  }): Promise<T> {
    if (!options.response.ok) {
      const errorText = await readErrorText(options.response);
      throw new Error(
        `${options.errorLabel} (${options.response.status}): ${errorText}`,
      );
    }

    return (await options.response.json()) as T;
  }
}
