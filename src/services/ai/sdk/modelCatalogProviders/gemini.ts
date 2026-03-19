import type { LLMModelOption } from "@/services/ai/types";
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
import { isSupportedGeminiToolCallingModelId } from "@/services/ai/utils/geminiModelSupport";
import { BaseAiSdkModelCatalogProvider } from "./base";

const GEMINI_MODELS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiModelsResponse = {
  models?: Array<{
    name?: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
  }>;
  nextPageToken?: string;
};

const normalizeGeminiModelId = (name: string) =>
  name.startsWith("models/") ? name.slice("models/".length) : name;

const createGeminiModelCapabilities = () =>
  createModelCapabilities({
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    supportsToolCalls: true,
  });

const matchesGeminiTask = (
  capabilities: LLMModelOption["capabilities"],
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

export class GeminiModelCatalogProvider extends BaseAiSdkModelCatalogProvider {
  readonly providerId = "gemini" as const;

  async fetchModels(options: AiSdkModelCatalogProviderRequest) {
    const config = this.getRequiredProviderConfig(options.appOptions);
    const models: Array<{
      id: string;
      label: string;
      capabilities: LLMModelOption["capabilities"];
    }> = [];
    let pageToken = "";

    do {
      const url = new URL(GEMINI_MODELS_ENDPOINT);
      url.searchParams.set("key", config.apiKey);
      url.searchParams.set("pageSize", "1000");
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await fetch(url.toString(), {
        signal: options.signal,
      });
      const json = await this.parseJsonOrThrow<GeminiModelsResponse>({
        response,
        errorLabel: "Gemini models request failed",
      });

      for (const item of json.models || []) {
        const name = typeof item.name === "string" ? item.name : "";
        if (!name) continue;

        const methods = Array.isArray(item.supportedGenerationMethods)
          ? item.supportedGenerationMethods
          : [];
        if (methods.length > 0 && !methods.includes("generateContent")) {
          continue;
        }

        const id = normalizeGeminiModelId(name);
        if (!isSupportedGeminiToolCallingModelId(id)) {
          continue;
        }

        models.push({
          id,
          label: item.displayName?.trim() || id,
          capabilities: createGeminiModelCapabilities(),
        });
      }

      pageToken =
        typeof json.nextPageToken === "string" ? json.nextPageToken : "";
    } while (pageToken);

    return this.normalizeDiscoveredModels(models);
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
        matchesGeminiTask(model.capabilities, options.kind),
      ),
    );
  }
}
