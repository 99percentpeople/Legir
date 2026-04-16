import type { LLMModelCapabilities } from "@/types";
import {
  createCustomModelCapabilities,
  createOpenAiLikeModelCapabilities,
  modelSupportsInputModality,
} from "@/services/ai/sdk/modelCapabilities";
import type { AiProviderId } from "@/services/ai/sdk/providerCatalog";
import type {
  AiSdkModelCatalogProviderRequest,
  AiSdkModelCatalogProviderTaskRequest,
  AiSdkTaskModelKind,
} from "@/services/ai/sdk/types";
import { BaseAiSdkModelCatalogProvider } from "./base";
import { joinUrl } from "./shared";

const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "https://api.openai.com/v1";

type OpenAiCompatibleModelsResponse = {
  data?: Array<{ id?: string }>;
};

const createOpenAiCompatibleModelCapabilities = (modelId: string) =>
  createOpenAiLikeModelCapabilities({ modelId });

const matchesOpenAiCompatibleTask = (
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

export class OpenAiCompatibleModelCatalogProvider extends BaseAiSdkModelCatalogProvider {
  constructor(readonly providerId: Extract<AiProviderId, "groq" | "xai">) {
    super();
  }

  async fetchModels(options: AiSdkModelCatalogProviderRequest) {
    const config = this.getRequiredProviderConfig(options.appOptions);
    const response = await this.fetchWithProxy(
      options,
      joinUrl(
        this.getProviderBaseUrl({
          appOptions: options.appOptions,
          fallbackBaseUrl: DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
        }),
        "/models",
      ),
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
                capabilities: createOpenAiCompatibleModelCapabilities(item.id),
              },
            ]
          : [],
      ),
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
        matchesOpenAiCompatibleTask(model.capabilities, options.kind),
      ),
    );
  }
}
