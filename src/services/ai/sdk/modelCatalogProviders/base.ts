import type { LLMModelOption } from "@/services/ai/types";
import { createCustomModelCapabilities } from "@/services/ai/sdk/modelCapabilities";
import {
  getAiProviderSpec,
  type AiProviderId,
} from "@/services/ai/sdk/providerCatalog";
import {
  getConfiguredAiSdkProvider,
  normalizeBaseUrl,
} from "@/services/ai/sdk/providers";
import type {
  AiSdkModelCallOptions,
  AiSdkDiscoveredModel,
  AiSdkModelCatalogProvider,
  AiSdkModelCatalogProviderCallOptionsRequest,
  AiSdkModelCatalogProviderRequest,
  AiSdkModelCatalogProviderTaskRequest,
} from "@/services/ai/sdk/types";

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

export abstract class BaseAiSdkModelCatalogProvider implements AiSdkModelCatalogProvider {
  abstract readonly providerId: AiProviderId;

  abstract fetchModels(
    options: AiSdkModelCatalogProviderRequest,
  ): Promise<LLMModelOption[]>;

  abstract getModelsForTask(
    options: AiSdkModelCatalogProviderTaskRequest,
  ): LLMModelOption[];

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

  protected getProviderBaseUrl(options: {
    appOptions: AiSdkModelCatalogProviderRequest["appOptions"];
    fallbackBaseUrl: string;
  }) {
    const config = this.getRequiredProviderConfig(options.appOptions);
    return normalizeBaseUrl(config.baseURL || options.fallbackBaseUrl);
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
