import type { LLMModelOption } from "@/services/ai/types";
import {
  getAiProviderSpec,
  type AiProviderId,
} from "@/services/ai/sdk/providerCatalog";
import {
  getConfiguredAiSdkProvider,
  normalizeBaseUrl,
} from "@/services/ai/sdk/providers";
import type {
  AiSdkDiscoveredModel,
  AiSdkModelCatalogProvider,
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
