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

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

type DeepSeekModelsResponse = {
  data?: Array<{ id?: string }>;
};

const supportsDeepSeekImageInput = (modelId: string) => {
  const normalizedModelId = modelId.trim().toLowerCase();
  if (!normalizedModelId) return false;

  return /(?:^|[-_/])(vision|vl)(?:[-_/]|$)/.test(normalizedModelId);
};

const supportsDeepSeekToolCalls = (modelId: string) => {
  const normalizedModelId = modelId.trim().toLowerCase();
  if (!normalizedModelId) return true;

  return ![
    /(?:^|[-_/])embedding(?:[-_/]|$)/,
    /(?:^|[-_/])tts(?:[-_/]|$)/,
    /(?:^|[-_/])whisper(?:[-_/]|$)/,
    /(?:^|[-_/])transcription(?:[-_/]|$)/,
    /(?:^|[-_/])speech(?:[-_/]|$)/,
  ].some((pattern) => pattern.test(normalizedModelId));
};

const createDeepSeekModelCapabilities = (modelId: string) =>
  createModelCapabilities({
    inputModalities: supportsDeepSeekImageInput(modelId)
      ? ["text", "image"]
      : ["text"],
    outputModalities: ["text"],
    supportsToolCalls: supportsDeepSeekToolCalls(modelId),
  });

const matchesDeepSeekTask = (
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

export class DeepSeekModelCatalogProvider extends BaseAiSdkModelCatalogProvider {
  readonly providerId = "deepseek" as const;

  async fetchModels(options: AiSdkModelCatalogProviderRequest) {
    const config = this.getRequiredProviderConfig(options.appOptions);
    const response = await fetch(
      joinUrl(
        this.getProviderBaseUrl({
          appOptions: options.appOptions,
          fallbackBaseUrl: DEFAULT_DEEPSEEK_BASE_URL,
        }),
        "/models",
      ),
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
        signal: options.signal,
      },
    );

    const json = await this.parseJsonOrThrow<DeepSeekModelsResponse>({
      response,
      errorLabel: "DeepSeek models request failed",
    });

    return this.normalizeDiscoveredModels(
      (json.data || []).flatMap((item) =>
        typeof item.id === "string"
          ? [
              {
                id: item.id,
                capabilities: createDeepSeekModelCapabilities(item.id),
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
        matchesDeepSeekTask(model.capabilities, options.kind),
      ),
    );
  }
}
