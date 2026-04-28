import type { AiProviderId } from "@/services/ai/providers/catalog";
import {
  AI_PROVIDER_DEFINITIONS,
  getAiProviderDefinition,
} from "@/services/ai/providers/definitions";

export { AI_PROVIDER_DEFINITIONS, getAiProviderDefinition };

export const getAiSdkModelCatalogProvider = (providerId: AiProviderId) =>
  getAiProviderDefinition(providerId).modelCatalogProvider;

export const getAiProviderDefinitions = () => AI_PROVIDER_DEFINITIONS;
