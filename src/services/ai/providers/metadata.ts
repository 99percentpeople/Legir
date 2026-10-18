import { DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS } from "@/constants";
import { getCatalogReasoningMetadata } from "./reasoning";
import { getModelsDevModel } from "./modelsDev";
import {
  getReasoningLevelControl,
  normalizeReasoningPreference,
} from "./runtimeAdapters/shared";
import type { AiReasoningPreference } from "./runtimeAdapters/types";
import type { LLMModelCapabilities } from "@/types";

export const resolveAiProviderModelMetadata = (
  providerId: string,
  modelId: string,
) => {
  const model = getModelsDevModel(providerId, modelId);
  const reasoning = getCatalogReasoningMetadata(providerId, modelId);
  return {
    providerId,
    modelId,
    contextWindowTokens:
      model?.limit?.context || DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
    hasContextWindowMetadata: !!model?.limit?.context,
    rank: 0,
    capabilities: model
      ? {
          inputModalities: model.modalities?.input,
          outputModalities: model.modalities?.output,
          supportsToolCalls: model.tool_call,
        }
      : undefined,
    reasoning,
  };
};
export const getAiProviderModelReasoningMetadata = (
  providerId: string,
  modelId: string,
) => resolveAiProviderModelMetadata(providerId, modelId).reasoning;
export const resolveAiProviderModelReasoning = (
  providerId: string,
  modelId: string,
  preference?: Partial<AiReasoningPreference> | null,
) =>
  getReasoningLevelControl(
    getAiProviderModelReasoningMetadata(providerId, modelId),
    normalizeReasoningPreference(preference),
  );
export const mergeModelCapabilitiesWithMetadata = (
  providerId: string,
  modelId: string,
  capabilities: LLMModelCapabilities,
): LLMModelCapabilities => {
  const metadata = resolveAiProviderModelMetadata(providerId, modelId);
  const inputModalities =
    metadata.capabilities?.inputModalities || capabilities.inputModalities;
  return {
    ...capabilities,
    inputModalities: [...inputModalities],
    supportsImageInput: inputModalities.includes("image"),
    outputModalities: [
      ...(metadata.capabilities?.outputModalities ||
        capabilities.outputModalities),
    ],
    supportsToolCalls:
      metadata.capabilities?.supportsToolCalls ??
      capabilities.supportsToolCalls,
    contextWindowTokens: metadata.hasContextWindowMetadata
      ? metadata.contextWindowTokens
      : capabilities.contextWindowTokens,
  };
};
