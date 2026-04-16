import type { LLMModelCapabilities } from "@/types";
import {
  createCustomModelCapabilities,
  createOpenAiLikeModelCapabilities,
  modelSupportsInputModality,
} from "@/services/ai/sdk/modelCapabilities";
import type {
  AiSdkModelCatalogProviderRequest,
  AiSdkModelCatalogProviderTaskRequest,
  AiSdkTaskModelKind,
} from "@/services/ai/sdk/types";
import { BaseAiSdkModelCatalogProvider } from "./base";
import { joinUrl } from "./shared";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

type OpenAiModelsResponse = {
  data?: Array<{ id?: string }>;
};

const createOpenAiModelCapabilities = (modelId: string) =>
  createOpenAiLikeModelCapabilities({ modelId });

const matchesOpenAiTask = (
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

export class OpenAiModelCatalogProvider extends BaseAiSdkModelCatalogProvider {
  readonly providerId = "openai" as const;

  async fetchModels(options: AiSdkModelCatalogProviderRequest) {
    const config = this.getRequiredProviderConfig(options.appOptions);
    const response = await this.fetchWithProxy(
      options,
      joinUrl(
        this.getProviderBaseUrl({
          appOptions: options.appOptions,
          fallbackBaseUrl: DEFAULT_OPENAI_BASE_URL,
        }),
        "/models",
      ),
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      },
    );

    const json = await this.parseJsonOrThrow<OpenAiModelsResponse>({
      response,
      errorLabel: "OpenAI models request failed",
    });

    return this.normalizeDiscoveredModels(
      (json.data || []).flatMap((item) =>
        typeof item.id === "string"
          ? [
              {
                id: item.id,
                capabilities: createOpenAiModelCapabilities(item.id),
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
        matchesOpenAiTask(model.capabilities, options.kind),
      ),
    );
  }
}
