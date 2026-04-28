import type { LLMModelOption } from "@/services/ai/types";
import {
  createCustomModelCapabilities,
  modelSupportsInputModality,
} from "@/services/ai/providers/modelCapabilities";
import {
  getAiProviderSpec,
  type AiProviderId,
} from "@/services/ai/providers/catalog";
import {
  getConfiguredAiSdkProvider,
  normalizeBaseUrl,
} from "@/services/ai/providers/config";
import { fetchWithApiProxy } from "@/services/platform/apiProxy";
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

const normalizeModelOptions = (
  models: AiSdkDiscoveredModel[],
): LLMModelOption[] => {
  const seen = new Set<string>();

  return models
    .map((model) => ({
      id: model.id.trim(),
      label: (model.label || model.id).trim() || model.id.trim(),
      capabilities: model.capabilities,
    }))
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
    return this.normalizeDiscoveredModels(
      this.getCachedAndCustomModels(options).filter((model) =>
        modelMatchesTaskKind(model.capabilities, options.kind),
      ),
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

  protected getRequiredProviderConfig(
    appOptions: AiSdkModelCatalogProviderRequest["appOptions"],
  ) {
    const config = getConfiguredAiSdkProvider(appOptions, this.providerId);
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
    return normalizeModelOptions(models);
  }

  protected getCachedAndCustomModels(
    options: AiSdkModelCatalogProviderTaskRequest,
  ) {
    const fetchedModels =
      options.modelCache[this.providerId][
        options.kind === "vision" ? "visionModels" : "translateModels"
      ];
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
