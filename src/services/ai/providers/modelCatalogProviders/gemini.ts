import { createModelCapabilities } from "@/services/ai/providers/modelCapabilities";
import type { AiSdkModelCatalogProviderRequest } from "@/services/ai/providers/types";
import { isSupportedGeminiToolCallingModelId } from "@/services/ai/utils/geminiModelSupport";
import { BaseAiSdkModelCatalogProvider } from "./base";
import type { LLMModelCapabilities } from "@/types";

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

export class GeminiModelCatalogProvider extends BaseAiSdkModelCatalogProvider {
  readonly providerId = "gemini" as const;

  async fetchModels(options: AiSdkModelCatalogProviderRequest) {
    const config = this.getRequiredProviderConfig(options.appOptions);
    const models: Array<{
      id: string;
      label: string;
      capabilities: LLMModelCapabilities;
    }> = [];
    let pageToken = "";

    do {
      const url = new URL(GEMINI_MODELS_ENDPOINT);
      url.searchParams.set("key", config.apiKey);
      url.searchParams.set("pageSize", "1000");
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await this.fetchWithProxy(options, url.toString());
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
}
