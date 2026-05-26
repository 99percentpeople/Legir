import type {
  AiSdkDiscoveredModel,
  AiSdkModelCatalogProviderRequest,
} from "@/services/ai/providers/types";
import { BaseAiSdkModelCatalogProvider } from "./base";

const GEMINI_MODELS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiModelsResponse = {
  models?: Array<{
    name?: string;
    displayName?: string;
    inputTokenLimit?: number;
    supportedGenerationMethods?: string[];
  }>;
  nextPageToken?: string;
};

const normalizeGeminiModelId = (name: string) =>
  name.startsWith("models/") ? name.slice("models/".length) : name;

export class GeminiModelCatalogProvider extends BaseAiSdkModelCatalogProvider {
  readonly providerId = "gemini" as const;

  async fetchModels(options: AiSdkModelCatalogProviderRequest) {
    const config = this.getRequiredProviderConfig(options.appOptions);
    const models: AiSdkDiscoveredModel[] = [];
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
        models.push({
          id,
          label: item.displayName?.trim() || id,
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportsToolCalls: false,
          contextWindowTokens:
            typeof item.inputTokenLimit === "number"
              ? item.inputTokenLimit
              : undefined,
        });
      }

      pageToken =
        typeof json.nextPageToken === "string" ? json.nextPageToken : "";
    } while (pageToken);

    return this.normalizeDiscoveredModels(models);
  }
}
