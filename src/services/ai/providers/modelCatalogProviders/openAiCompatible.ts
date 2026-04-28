import { createOpenAiLikeModelCapabilities } from "@/services/ai/providers/modelCapabilities";
import type { AiProviderId } from "@/services/ai/providers/catalog";
import type { AiSdkModelCatalogProviderRequest } from "@/services/ai/providers/types";
import { BaseAiSdkModelCatalogProvider } from "./base";
import { joinUrl } from "./shared";

type OpenAiCompatibleModelsResponse = {
  data?: Array<{ id?: string }>;
};

export class OpenAiCompatibleModelCatalogProvider extends BaseAiSdkModelCatalogProvider {
  constructor(
    readonly providerId: AiProviderId,
    private readonly options: {
      extraNonToolPatterns?: readonly RegExp[];
    } = {},
  ) {
    super();
  }

  async fetchModels(options: AiSdkModelCatalogProviderRequest) {
    const config = this.getRequiredProviderConfig(options.appOptions);
    const response = await this.fetchWithProxy(
      options,
      joinUrl(this.getProviderBaseUrl(config), "/models"),
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      },
    );

    const json = await this.parseJsonOrThrow<OpenAiCompatibleModelsResponse>({
      response,
      errorLabel: `${this.getProviderSpec().label} models request failed`,
    });

    return this.normalizeDiscoveredModels(
      (json.data || []).flatMap((item) =>
        typeof item.id === "string"
          ? [
              {
                id: item.id,
                capabilities: createOpenAiLikeModelCapabilities({
                  modelId: item.id,
                  extraNonToolPatterns: this.options.extraNonToolPatterns,
                }),
              },
            ]
          : [],
      ),
    );
  }
}
