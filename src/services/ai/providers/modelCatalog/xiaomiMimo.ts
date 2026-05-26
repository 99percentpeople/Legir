import type { AiSdkModelCatalogProviderRequest } from "@/services/ai/providers/types";
import { getAiProviderSelectedApiOption } from "@/services/ai/providers/catalog";
import { BaseAiSdkModelCatalogProvider } from "./base";

export class XiaomiMimoModelCatalogProvider extends BaseAiSdkModelCatalogProvider {
  readonly providerId = "xiaomi-mimo" as const;

  async fetchModels(options: AiSdkModelCatalogProviderRequest) {
    const selectedApiOption = getAiProviderSelectedApiOption(
      this.providerId,
      options.appOptions.llm[this.providerId].apiOptionId,
    );

    const curatedModels = this.getCuratedModels(options.appOptions);
    if (selectedApiOption?.id === "anthropic") {
      return this.normalizeDiscoveredModels(curatedModels);
    }

    return this.fetchOpenAiCompatibleModels({
      request: options,
      errorLabel: "Xiaomi MiMo models request failed",
    });
  }
}
