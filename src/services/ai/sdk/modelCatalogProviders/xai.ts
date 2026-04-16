import type { LLMModelCapabilities } from "@/types";
import {
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

const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";

type XaiLanguageModelsResponse = {
  models?: Array<{
    id?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  }>;
};

const normalizeApiModalities = (values: readonly string[] | undefined) =>
  (values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean);

const createXaiModelCapabilities = (options: {
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

const matchesXaiTask = (
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

export class XaiModelCatalogProvider extends BaseAiSdkModelCatalogProvider {
  readonly providerId = "xai" as const;

  async fetchModels(options: AiSdkModelCatalogProviderRequest) {
    const config = this.getRequiredProviderConfig(options.appOptions);
    const response = await this.fetchWithProxy(
      options,
      joinUrl(
        this.getProviderBaseUrl({
          appOptions: options.appOptions,
          fallbackBaseUrl: DEFAULT_XAI_BASE_URL,
        }),
        "/language-models",
      ),
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      },
    );

    const json = await this.parseJsonOrThrow<XaiLanguageModelsResponse>({
      response,
      errorLabel: "xAI models request failed",
    });

    return this.normalizeDiscoveredModels(
      (json.models || []).flatMap((item) => {
        const id = typeof item.id === "string" ? item.id.trim() : "";
        if (!id) return [];

        return [
          {
            id,
            capabilities: createXaiModelCapabilities({
              inputModalities: item.input_modalities,
              outputModalities: item.output_modalities,
            }),
          },
        ];
      }),
    );
  }

  getModelsForTask(options: AiSdkModelCatalogProviderTaskRequest) {
    return this.normalizeDiscoveredModels(
      this.getCachedAndCustomModels(options).filter((model) =>
        matchesXaiTask(model.capabilities, options.kind),
      ),
    );
  }
}
