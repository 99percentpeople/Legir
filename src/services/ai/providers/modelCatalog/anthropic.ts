import type {
  AiSdkDiscoveredModel,
  AiSdkModelCatalogProviderRequest,
} from "@/services/ai/providers/types";
import type { AiProviderId } from "@/services/ai/providers/catalog";
import { BaseAiSdkModelCatalogProvider } from "./base";
import { joinUrl } from "./shared";

type AnthropicModelsResponse = {
  data?: Array<{
    id?: string;
    display_name?: string;
  }>;
  has_more?: boolean;
  last_id?: string;
};

export class AnthropicModelCatalogProvider extends BaseAiSdkModelCatalogProvider {
  constructor(readonly providerId: AiProviderId = "anthropic") {
    super();
  }

  async fetchModels(options: AiSdkModelCatalogProviderRequest) {
    const config = this.getRequiredProviderConfig(options.appOptions);
    const models: AiSdkDiscoveredModel[] = [];
    let afterId = "";

    do {
      const url = new URL(joinUrl(this.getProviderBaseUrl(config), "/models"));
      url.searchParams.set("limit", "1000");
      if (afterId) {
        url.searchParams.set("after_id", afterId);
      }

      const response = await this.fetchWithProxy(options, url.toString(), {
        headers: {
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
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
          inputModalities: ["text", "image"],
          outputModalities: ["text"],
          supportsToolCalls: true,
        });
      }

      afterId =
        json.has_more && typeof json.last_id === "string"
          ? json.last_id.trim()
          : "";
    } while (afterId);

    return this.normalizeDiscoveredModels(models);
  }
}
