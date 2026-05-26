import type { AiSdkModelCatalogProviderRequest } from "@/services/ai/providers/types";
import { BaseAiSdkModelCatalogProvider } from "./base";
import { joinUrl } from "./shared";

type OpenRouterModelsResponse = {
  data?: Array<{
    id?: string;
    name?: string;
    input_modalities?: string[];
    output_modalities?: string[];
    architecture?: {
      input_modalities?: string[];
      output_modalities?: string[];
      modality?: string;
    };
    context_length?: number;
    supported_parameters?: string[];
  }>;
};

export class OpenRouterModelCatalogProvider extends BaseAiSdkModelCatalogProvider {
  readonly providerId = "openrouter" as const;

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

    const json = await this.parseJsonOrThrow<OpenRouterModelsResponse>({
      response,
      errorLabel: "OpenRouter models request failed",
    });

    return this.normalizeDiscoveredModels(
      (json.data || []).flatMap((item) => {
        const id = typeof item.id === "string" ? item.id : "";
        if (!id) return [];

        const inputModalities =
          item.input_modalities ||
          item.architecture?.input_modalities ||
          (item.architecture?.modality
            ? [item.architecture.modality]
            : undefined);
        const outputModalities =
          item.output_modalities || item.architecture?.output_modalities;
        const supportedParameters = Array.isArray(item.supported_parameters)
          ? item.supported_parameters
          : undefined;

        return [
          {
            id,
            label: item.name,
            inputModalities,
            outputModalities,
            supportsToolCalls: supportedParameters
              ? supportedParameters.includes("tools")
              : undefined,
            contextWindowTokens:
              typeof item.context_length === "number"
                ? item.context_length
                : undefined,
          },
        ];
      }),
    );
  }
}
