import type { AiSdkModelCatalogProviderRequest } from "@/services/ai/providers/types";
import { getAiProviderSelectedApiOption } from "@/services/ai/providers/catalog";
import { BaseAiSdkModelCatalogProvider } from "./base";

export class MinimaxModelCatalogProvider extends BaseAiSdkModelCatalogProvider {
  readonly providerId = "minimax" as const;

  async fetchModels(options: AiSdkModelCatalogProviderRequest) {
    const selectedApiOption = getAiProviderSelectedApiOption(
      this.providerId,
      options.appOptions.llm[this.providerId].apiOptionId,
    );

    if (selectedApiOption?.id === "openai") {
      return this.fetchOpenAiCompatibleModels({
        request: options,
        errorLabel: "MiniMax models request failed",
      });
    }

    return this.normalizeDiscoveredModels(
      this.getCuratedModels(options.appOptions),
    );
  }
}
