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

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

type OpenAiModelsResponse = {
  data?: Array<{ id?: string }>;
};

const supportsOpenAiImageInput = (modelId: string) => {
  const normalizedModelId = modelId.trim().toLowerCase();
  if (!normalizedModelId) return false;

  return [
    /^gpt-4o(?:[-:]|$)/,
    /^gpt-4\.1(?:[-:]|$)/,
    /^gpt-4\.5(?:[-:]|$)/,
    /^gpt-5(?:[-:]|$)/,
  ].some((pattern) => pattern.test(normalizedModelId));
};

const supportsOpenAiToolCalls = (modelId: string) => {
  const normalizedModelId = modelId.trim().toLowerCase();
  if (!normalizedModelId) return true;

  return ![
    /(?:^|[-_/])embedding(?:[-_/]|$)/,
    /(?:^|[-_/])moderation(?:[-_/]|$)/,
    /(?:^|[-_/])tts(?:[-_/]|$)/,
    /(?:^|[-_/])whisper(?:[-_/]|$)/,
    /(?:^|[-_/])transcription(?:[-_/]|$)/,
    /(?:^|[-_/])speech(?:[-_/]|$)/,
    /(?:^|[-_/])image(?:[-_/]|$)/,
  ].some((pattern) => pattern.test(normalizedModelId));
};

const createOpenAiModelCapabilities = (modelId: string) =>
  createModelCapabilities({
    inputModalities: supportsOpenAiImageInput(modelId)
      ? ["text", "image"]
      : ["text"],
    outputModalities: ["text"],
    supportsToolCalls: supportsOpenAiToolCalls(modelId),
  });

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
    const response = await fetch(
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
        signal: options.signal,
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
