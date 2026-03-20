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

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";

type AnthropicModelsResponse = {
  data?: Array<{
    id?: string;
    display_name?: string;
  }>;
  has_more?: boolean;
  last_id?: string;
};

const createAnthropicModelCapabilities = () =>
  createModelCapabilities({
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    supportsToolCalls: true,
  });

const matchesAnthropicTask = (
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

export class AnthropicModelCatalogProvider extends BaseAiSdkModelCatalogProvider {
  readonly providerId = "anthropic" as const;

  async fetchModels(options: AiSdkModelCatalogProviderRequest) {
    const config = this.getRequiredProviderConfig(options.appOptions);
    const models: Array<{
      id: string;
      label?: string;
      capabilities: LLMModelCapabilities;
    }> = [];
    let afterId = "";

    do {
      const url = new URL(
        joinUrl(
          this.getProviderBaseUrl({
            appOptions: options.appOptions,
            fallbackBaseUrl: DEFAULT_ANTHROPIC_BASE_URL,
          }),
          "/models",
        ),
      );
      url.searchParams.set("limit", "1000");
      if (afterId) {
        url.searchParams.set("after_id", afterId);
      }

      const response = await fetch(url.toString(), {
        headers: {
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: options.signal,
      });

      const json = await this.parseJsonOrThrow<AnthropicModelsResponse>({
        response,
        errorLabel: "Anthropic models request failed",
      });

      for (const item of json.data || []) {
        const id = typeof item.id === "string" ? item.id.trim() : "";
        if (!id) continue;

        models.push({
          id,
          label:
            typeof item.display_name === "string"
              ? item.display_name.trim()
              : undefined,
          capabilities: createAnthropicModelCapabilities(),
        });
      }

      afterId =
        json.has_more && typeof json.last_id === "string"
          ? json.last_id.trim()
          : "";
    } while (afterId);

    return this.normalizeDiscoveredModels(models);
  }

  getModelsForTask(options: AiSdkModelCatalogProviderTaskRequest) {
    return this.normalizeDiscoveredModels(
      this.getCachedAndCustomModels(options).filter((model) =>
        matchesAnthropicTask(model.capabilities, options.kind),
      ),
    );
  }
}
