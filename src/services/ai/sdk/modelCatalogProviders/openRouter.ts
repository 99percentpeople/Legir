import type { LLMModelCapabilities } from "@/types";
import {
  createCustomModelCapabilities,
  createModelCapabilities,
  modelSupportsInputModality,
} from "@/services/ai/sdk/modelCapabilities";
import type {
  AiSdkModelCatalogProviderRequest,
  AiSdkModelCatalogProviderTaskRequest,
  AiSdkTaskModelKind,
} from "@/services/ai/sdk/types";
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
  }>;
};

const normalizeApiModalities = (values: readonly string[] | undefined) =>
  (values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean);

const createOpenRouterModelCapabilities = (options: {
  inputModalities?: readonly string[];
  outputModalities?: readonly string[];
}) => {
  const normalizedInputModalities = normalizeApiModalities(
    options.inputModalities,
  );
  const normalizedOutputModalities = normalizeApiModalities(
    options.outputModalities,
  );

  return createModelCapabilities({
    inputModalities:
      normalizedInputModalities.length > 0
        ? normalizedInputModalities
        : ["text"],
    outputModalities:
      normalizedOutputModalities.length > 0
        ? normalizedOutputModalities
        : ["text"],
    supportsToolCalls: true,
  });
};

const matchesOpenRouterTask = (
  capabilities: LLMModelCapabilities,
  kind: AiSdkTaskModelKind,
) => {
  if (kind === "vision") {
    return capabilities.supportsImageInput;
  }

  if (kind === "chat") {
    return capabilities.supportsToolCalls;
  }

  return modelSupportsInputModality(capabilities, "text");
};

export class OpenRouterModelCatalogProvider extends BaseAiSdkModelCatalogProvider {
  readonly providerId = "openrouter" as const;

  async fetchModels(options: AiSdkModelCatalogProviderRequest) {
    const config = this.getRequiredProviderConfig(options.appOptions);
    const response = await this.fetchWithProxy(
      options,
      joinUrl(
        this.getProviderBaseUrl({
          appOptions: options.appOptions,
          fallbackBaseUrl: "https://openrouter.ai/api/v1",
        }),
        "/models",
      ),
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

        return [
          {
            id,
            label: item.name,
            capabilities: createOpenRouterModelCapabilities({
              inputModalities,
              outputModalities,
            }),
          },
        ];
      }),
    );
  }

  getModelsForTask(options: AiSdkModelCatalogProviderTaskRequest) {
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

    return this.normalizeDiscoveredModels(
      [...fetchedModels, ...customModels].filter((model) =>
        matchesOpenRouterTask(model.capabilities, options.kind),
      ),
    );
  }
}
