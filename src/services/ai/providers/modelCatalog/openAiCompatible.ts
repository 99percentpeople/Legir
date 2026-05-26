import type { AiProviderId } from "@/services/ai/providers/catalog";
import type { AiSdkModelCatalogProviderRequest } from "@/services/ai/providers/types";
import { BaseAiSdkModelCatalogProvider } from "./base";

export class OpenAiCompatibleModelCatalogProvider extends BaseAiSdkModelCatalogProvider {
  constructor(readonly providerId: AiProviderId) {
    super();
  }

  async fetchModels(options: AiSdkModelCatalogProviderRequest) {
    return this.fetchOpenAiCompatibleModels({
      request: options,
      errorLabel: `${this.getProviderSpec().label} models request failed`,
      requireCuratedFallback: true,
    });
  }
}
