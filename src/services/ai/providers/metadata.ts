import type { AiProviderId } from "@/services/ai/providers/catalog";
import { DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS } from "@/constants";
import {
  AI_MODELS,
  type AiModelCapabilityMetadata,
  type AiModelEntry,
  type AiModelMetadata,
  type AiModelReasoningMetadata,
} from "@/services/ai/providers/models";
import {
  getReasoningLevelControl,
  normalizeReasoningPreference,
  NO_REASONING_CAPABILITY,
} from "@/services/ai/providers/runtimeAdapters/shared";
import type {
  AiReasoningLevelControl,
  AiReasoningPreference,
} from "@/services/ai/providers/runtimeAdapters/types";
import type { LLMModelCapabilities } from "@/types";

export type AiResolvedProviderModelMetadata = {
  providerId: AiProviderId;
  modelId: string;
  contextWindowTokens: number;
  hasContextWindowMetadata: boolean;
  capabilities?: AiModelCapabilityMetadata;
  reasoning: AiModelReasoningMetadata;
};

const getModelRuleMatchCandidates = (modelId: string) => {
  const normalizedModelId = modelId.trim();
  if (!normalizedModelId) return [];

  const slashLeaf = normalizedModelId.split("/").at(-1)?.trim() || "";
  return slashLeaf && slashLeaf !== normalizedModelId
    ? [normalizedModelId, slashLeaf]
    : [normalizedModelId];
};

const matchesProviderRule = (providerId: AiProviderId, rule: AiModelEntry) =>
  !rule.providers || rule.providers.includes(providerId);

const matchesModelRule = (modelId: string, rule: AiModelEntry) => {
  const candidates = getModelRuleMatchCandidates(modelId);
  if (candidates.length === 0) return false;

  // Match both the provider-prefixed id and its leaf id so rules can apply to
  // OpenRouter-style ids such as "openai/gpt-4.1" without duplicating entries.
  return candidates.some((candidate) => {
    const normalizedCandidate = candidate.toLowerCase();
    const exactMatch = (rule.modelIds || []).some(
      (exactModelId) => normalizedCandidate === exactModelId.toLowerCase(),
    );
    if (exactMatch) return true;

    return (rule.patterns || []).some((pattern) => pattern.test(candidate));
  });
};

const mergeReasoning = (
  base: AiModelReasoningMetadata,
  next?: AiModelReasoningMetadata,
): AiModelReasoningMetadata => {
  if (!next) return base;
  if (!next.supported) return next;
  return { ...base, ...next };
};

const mergeCapabilityMetadata = (
  base: AiModelCapabilityMetadata | undefined,
  next?: AiModelCapabilityMetadata,
): AiModelCapabilityMetadata | undefined =>
  next ? { ...(base ?? {}), ...next } : base;

export const resolveAiProviderModelMetadata = (
  providerId: AiProviderId,
  modelId: string,
): AiResolvedProviderModelMetadata => {
  let contextWindowTokens = DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
  let hasContextWindowMetadata = false;
  let capabilities: AiModelCapabilityMetadata | undefined;
  let modelReasoning = NO_REASONING_CAPABILITY as AiModelReasoningMetadata;

  for (const rule of AI_MODELS) {
    const metadata: AiModelMetadata | undefined = rule.metadata;
    if (!metadata) continue;
    if (!matchesProviderRule(providerId, rule)) continue;
    if (!matchesModelRule(modelId, rule)) continue;
    if (metadata.contextWindowTokens) {
      contextWindowTokens = Math.max(
        1,
        Math.trunc(metadata.contextWindowTokens),
      );
      hasContextWindowMetadata = true;
    }
    capabilities = mergeCapabilityMetadata(capabilities, metadata.capabilities);
    modelReasoning = mergeReasoning(modelReasoning, metadata.reasoning);
  }

  return {
    providerId,
    modelId,
    contextWindowTokens,
    hasContextWindowMetadata,
    capabilities,
    reasoning: modelReasoning,
  };
};

export const getAiProviderModelReasoningMetadata = (
  providerId: AiProviderId,
  modelId: string,
) => resolveAiProviderModelMetadata(providerId, modelId).reasoning;

export const resolveAiProviderModelReasoning = (
  providerId: AiProviderId,
  modelId: string,
  preference?: Partial<AiReasoningPreference> | null,
): AiReasoningLevelControl => {
  const capability = getAiProviderModelReasoningMetadata(providerId, modelId);
  return getReasoningLevelControl(
    capability,
    normalizeReasoningPreference(preference),
  );
};

export const mergeModelCapabilitiesWithMetadata = (
  providerId: AiProviderId,
  modelId: string,
  capabilities: LLMModelCapabilities,
): LLMModelCapabilities => {
  const metadata = resolveAiProviderModelMetadata(providerId, modelId);
  const inputModalities =
    metadata.capabilities?.inputModalities ?? capabilities.inputModalities;
  const outputModalities =
    metadata.capabilities?.outputModalities ?? capabilities.outputModalities;
  const supportsToolCalls =
    metadata.capabilities?.supportsToolCalls ?? capabilities.supportsToolCalls;
  const supportsImageToolResults =
    metadata.capabilities?.supportsImageToolResults ??
    capabilities.supportsImageToolResults;

  return {
    inputModalities: [...inputModalities],
    outputModalities: [...outputModalities],
    supportsImageInput: inputModalities.includes("image"),
    supportsToolCalls,
    supportsImageToolResults,
    contextWindowTokens: metadata.hasContextWindowMetadata
      ? metadata.contextWindowTokens
      : capabilities.contextWindowTokens,
  };
};
