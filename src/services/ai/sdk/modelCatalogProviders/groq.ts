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

const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1";

type GroqModelsResponse = {
  data?: Array<{ id?: string }>;
};

const matchAny = (value: string, patterns: RegExp[]) =>
  patterns.some((pattern) => pattern.test(value));

const supportsGroqImageInput = (modelId: string) =>
  matchAny(modelId.trim().toLowerCase(), [
    /(?:^|[-_/])(vision|vl)(?:[-_/]|$)/,
    /(?:^|[-_/])llama-4(?:[-_/]|$)/,
    /(?:^|[-_/])pixtral(?:[-_/]|$)/,
    /(?:^|[-_/])gemma-3(?:[-_/]|$)/,
    /(?:^|[-_/])minicpm[-_]?v(?:[-_/]|$)/,
    /(?:^|[-_/])phi-3\.5-vision(?:[-_/]|$)/,
    /(?:^|[-_/])qwen(?:2(?:\.5)?)?[-_]?vl(?:[-_/]|$)/,
    /(?:^|[-_/])internvl(?:[-_/]|$)/,
    /(?:^|[-_/])glm-4(?:\.\d+)?v(?:[-_/]|$)/,
    /(?:^|[-_/])kimi[-_]?vl(?:[-_/]|$)/,
  ]);

const supportsGroqToolCalls = (modelId: string) =>
  !matchAny(modelId.trim().toLowerCase(), [
    /(?:^|[-_/])embedding(?:[-_/]|$)/,
    /(?:^|[-_/])moderation(?:[-_/]|$)/,
    /(?:^|[-_/])tts(?:[-_/]|$)/,
    /(?:^|[-_/])whisper(?:[-_/]|$)/,
    /(?:^|[-_/])transcription(?:[-_/]|$)/,
    /(?:^|[-_/])speech(?:[-_/]|$)/,
    /(?:^|[-_/])audio(?:[-_/]|$)/,
    /(?:^|[-_/])image(?:[-_/]|$)/,
  ]);

const createGroqModelCapabilities = (modelId: string) =>
  createModelCapabilities({
    inputModalities: supportsGroqImageInput(modelId)
      ? ["text", "image"]
      : ["text"],
    outputModalities: ["text"],
    supportsToolCalls: supportsGroqToolCalls(modelId),
  });

const matchesGroqTask = (
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

export class GroqModelCatalogProvider extends BaseAiSdkModelCatalogProvider {
  readonly providerId = "groq" as const;

  async fetchModels(options: AiSdkModelCatalogProviderRequest) {
    const config = this.getRequiredProviderConfig(options.appOptions);
    const response = await fetch(
      joinUrl(
        this.getProviderBaseUrl({
          appOptions: options.appOptions,
          fallbackBaseUrl: DEFAULT_GROQ_BASE_URL,
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

    const json = await this.parseJsonOrThrow<GroqModelsResponse>({
      response,
      errorLabel: "Groq models request failed",
    });

    return this.normalizeDiscoveredModels(
      (json.data || []).flatMap((item) =>
        typeof item.id === "string"
          ? [
              {
                id: item.id,
                capabilities: createGroqModelCapabilities(item.id),
              },
            ]
          : [],
      ),
    );
  }

  getModelsForTask(options: AiSdkModelCatalogProviderTaskRequest) {
    return this.normalizeDiscoveredModels(
      this.getCachedAndCustomModels(options).filter((model) =>
        matchesGroqTask(model.capabilities, options.kind),
      ),
    );
  }
}
