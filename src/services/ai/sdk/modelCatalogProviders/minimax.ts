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
import { getAiProviderSelectedApiOption } from "@/services/ai/sdk/providerCatalog";
import { BaseAiSdkModelCatalogProvider } from "./base";
import { joinUrl } from "./shared";

const DEFAULT_MINIMAX_OPENAI_BASE_URL = "https://api.minimax.io/v1";

type MinimaxModelsResponse = {
  data?: Array<{ id?: string }>;
};

const CURATED_MINIMAX_MODEL_IDS = [
  "MiniMax-M2.7",
  "MiniMax-M2.7-highspeed",
  "MiniMax-M2.5",
  "MiniMax-M2.5-highspeed",
  "MiniMax-M2.1",
  "MiniMax-M2.1-highspeed",
  "MiniMax-M2",
] as const;

const createMinimaxModelCapabilities = () =>
  createModelCapabilities({
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsToolCalls: true,
  });

const matchesMinimaxTask = (
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

const getCuratedMinimaxModels = () =>
  CURATED_MINIMAX_MODEL_IDS.map((id) => ({
    id,
    capabilities: createMinimaxModelCapabilities(),
  }));

export class MinimaxModelCatalogProvider extends BaseAiSdkModelCatalogProvider {
  readonly providerId = "minimax" as const;

  async fetchModels(options: AiSdkModelCatalogProviderRequest) {
    const selectedApiOption = getAiProviderSelectedApiOption(
      this.providerId,
      options.appOptions.llm[this.providerId].apiOptionId,
    );

    if (selectedApiOption?.id === "openai") {
      const config = this.getRequiredProviderConfig(options.appOptions);
      const response = await this.fetchWithProxy(
        options,
        joinUrl(
          this.getProviderBaseUrl({
            appOptions: options.appOptions,
            fallbackBaseUrl: DEFAULT_MINIMAX_OPENAI_BASE_URL,
          }),
          "/models",
        ),
        {
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
          },
        },
      );

      if (response.status === 404 || response.status === 405) {
        return this.normalizeDiscoveredModels(getCuratedMinimaxModels());
      }

      const json = await this.parseJsonOrThrow<MinimaxModelsResponse>({
        response,
        errorLabel: "MiniMax models request failed",
      });

      const discoveredModels = (json.data || []).flatMap((item) =>
        typeof item.id === "string"
          ? [
              {
                id: item.id,
                capabilities: createMinimaxModelCapabilities(),
              },
            ]
          : [],
      );

      return this.normalizeDiscoveredModels(
        discoveredModels.length > 0
          ? discoveredModels
          : getCuratedMinimaxModels(),
      );
    }

    return this.normalizeDiscoveredModels(getCuratedMinimaxModels());
  }

  getModelsForTask(options: AiSdkModelCatalogProviderTaskRequest) {
    return this.normalizeDiscoveredModels(
      this.getCachedAndCustomModels(options).filter((model) =>
        matchesMinimaxTask(model.capabilities, options.kind),
      ),
    );
  }
}
