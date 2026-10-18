import { createModelCapabilities } from "./capabilities";
import { getModelsDevProvider } from "./modelsDev";
import type { AiSdkDiscoveredModel } from "./types";
export type { AiModelReasoningMetadata } from "./reasoning";
export const createAiDiscoveredModel = (
  options: Omit<AiSdkDiscoveredModel, "id"> & { modelId: string },
) => ({
  id: options.modelId.trim(),
  label: options.label || options.modelId,
  rank: options.rank,
  capabilities:
    options.capabilities ||
    createModelCapabilities({
      inputModalities: options.inputModalities || ["text"],
      outputModalities: options.outputModalities || ["text"],
      supportsToolCalls: options.supportsToolCalls === true,
      contextWindowTokens: options.contextWindowTokens,
    }),
});
/** Catalog fallback only. This is not proof that the user's account can access a model. */
export const getCatalogModels = (providerId: string): AiSdkDiscoveredModel[] =>
  Object.values(getModelsDevProvider(providerId)?.models || {})
    .filter((model) => model.status !== "deprecated")
    .map((model) => ({
      id: model.id,
      label: model.name,
      inputModalities: model.modalities?.input,
      outputModalities: model.modalities?.output,
      supportsToolCalls: model.tool_call,
      contextWindowTokens: model.limit?.context,
    }));
