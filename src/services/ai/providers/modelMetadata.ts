import type { AiProviderId } from "@/services/ai/providers/catalog";
import type {
  AiReasoningCapability,
  AiReasoningEffort,
} from "@/services/ai/providers/runtimeProfiles/types";
import { NO_REASONING_CAPABILITY } from "@/services/ai/providers/runtimeProfiles/shared";
import type { LLMModelCapabilities, LLMModelModality } from "@/types";

export const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 128_000;

export type AiReasoningOffStrategy =
  | "none"
  | "provider-switch"
  | "gemini-thinking-budget-zero"
  | "openai-reasoning-effort-none";

export type AiModelReasoningMetadata = AiReasoningCapability & {
  supportedEfforts?: readonly AiReasoningEffort[];
  offStrategy?: AiReasoningOffStrategy;
};

export type AiModelCapabilityMetadata = {
  inputModalities?: readonly LLMModelModality[];
  outputModalities?: readonly LLMModelModality[];
  supportsToolCalls?: boolean;
};

export type AiProviderModelMetadata = {
  contextWindowTokens?: number;
  capabilities?: AiModelCapabilityMetadata;
  reasoning?: AiModelReasoningMetadata;
};

type AiModelMetadataRule = {
  id: string;
  providers?: readonly AiProviderId[];
  match: string | RegExp;
  metadata: AiProviderModelMetadata;
};

export type AiResolvedProviderModelMetadata = {
  providerId: AiProviderId;
  modelId: string;
  contextWindowTokens: number;
  capabilities?: AiModelCapabilityMetadata;
  reasoning: AiModelReasoningMetadata;
};

const reasoning = (
  value: Omit<AiModelReasoningMetadata, "supported">,
): AiModelReasoningMetadata => ({
  supported: true,
  ...value,
});

const OPENAI_REASONING: AiModelReasoningMetadata = reasoning({
  supportsModeSwitch: false,
  supportsEffort: true,
  supportsBudgetTokens: false,
  supportedEfforts: ["low", "medium", "high"],
  textExposure: "none",
  requiresReasoningReplay: "none",
});

const OPENAI_REASONING_WITH_NONE: AiModelReasoningMetadata = {
  ...OPENAI_REASONING,
  offStrategy: "openai-reasoning-effort-none",
};

const GEMINI_2_5_REASONING: AiModelReasoningMetadata = reasoning({
  supportsModeSwitch: true,
  supportsEffort: true,
  supportsBudgetTokens: true,
  supportedEfforts: ["low", "medium", "high"],
  offStrategy: "gemini-thinking-budget-zero",
  textExposure: "summary",
  requiresReasoningReplay: "none",
});

const GEMINI_3_REASONING: AiModelReasoningMetadata = reasoning({
  supportsModeSwitch: false,
  supportsEffort: true,
  supportsBudgetTokens: false,
  supportedEfforts: ["low", "medium", "high"],
  textExposure: "summary",
  requiresReasoningReplay: "none",
});

const DEEPSEEK_REASONING: AiModelReasoningMetadata = reasoning({
  supportsModeSwitch: true,
  supportsEffort: false,
  supportsBudgetTokens: false,
  offStrategy: "provider-switch",
  textExposure: "raw",
  requiresReasoningReplay: "tool-calls",
});

const ANTHROPIC_REASONING: AiModelReasoningMetadata = reasoning({
  supportsModeSwitch: true,
  supportsEffort: false,
  supportsBudgetTokens: true,
  textExposure: "summary",
  requiresReasoningReplay: "all",
});

const MINIMAX_RAW_REASONING: AiModelReasoningMetadata = {
  ...ANTHROPIC_REASONING,
  textExposure: "raw",
};

const textImageTools: AiModelCapabilityMetadata = {
  inputModalities: ["text", "image"],
  outputModalities: ["text"],
  supportsToolCalls: true,
};

const AI_MODEL_METADATA_RULES = [
  {
    id: "gpt-4.1",
    match: /^gpt-4\.1/i,
    metadata: {
      contextWindowTokens: 1_000_000,
      capabilities: textImageTools,
    },
  },
  {
    id: "gpt-5.1",
    match: /^gpt-5\.1/i,
    metadata: {
      contextWindowTokens: 400_000,
      capabilities: textImageTools,
    },
  },
  {
    id: "openai:gpt-5.1-reasoning",
    providers: ["openai"],
    match: /^gpt-5\.1/i,
    metadata: {
      reasoning: OPENAI_REASONING_WITH_NONE,
    },
  },
  {
    id: "gpt-5",
    match: /^gpt-5/i,
    metadata: {
      contextWindowTokens: 400_000,
      capabilities: textImageTools,
    },
  },
  {
    id: "openai:gpt-5-reasoning",
    providers: ["openai"],
    match: /^gpt-5/i,
    metadata: {
      reasoning: OPENAI_REASONING,
    },
  },
  {
    id: "openai-reasoning-family",
    match: /^(o\d|codex|computer-use|reasoning)/i,
    metadata: {
      contextWindowTokens: 200_000,
    },
  },
  {
    id: "openai:reasoning-family",
    providers: ["openai"],
    match: /^(o\d|codex|computer-use|reasoning)/i,
    metadata: {
      reasoning: OPENAI_REASONING,
    },
  },
  {
    id: "gpt-4.5",
    match: /^gpt-4\.5/i,
    metadata: {
      contextWindowTokens: 128_000,
      capabilities: textImageTools,
    },
  },
  {
    id: "openai:gpt-4.5-reasoning",
    providers: ["openai"],
    match: /^gpt-4\.5/i,
    metadata: {
      reasoning: OPENAI_REASONING,
    },
  },
  {
    id: "gpt-4o",
    match: /^gpt-4o/i,
    metadata: {
      contextWindowTokens: 128_000,
      capabilities: textImageTools,
    },
  },
  {
    id: "claude",
    match: /^claude/i,
    metadata: {
      contextWindowTokens: 200_000,
      capabilities: textImageTools,
    },
  },
  {
    id: "anthropic:claude-reasoning",
    providers: ["anthropic"],
    match: /^claude/i,
    metadata: {
      reasoning: ANTHROPIC_REASONING,
    },
  },
  {
    id: "gemini-2.5",
    match: /^gemini-2\.5/i,
    metadata: {
      contextWindowTokens: 1_048_576,
      capabilities: textImageTools,
    },
  },
  {
    id: "gemini:gemini-2.5-reasoning",
    providers: ["gemini"],
    match: /^gemini-2\.5/i,
    metadata: {
      reasoning: GEMINI_2_5_REASONING,
    },
  },
  {
    id: "gemini-3",
    match: /^gemini-3/i,
    metadata: {
      contextWindowTokens: 1_048_576,
      capabilities: textImageTools,
    },
  },
  {
    id: "gemini:gemini-3-reasoning",
    providers: ["gemini"],
    match: /^gemini-3/i,
    metadata: {
      reasoning: GEMINI_3_REASONING,
    },
  },
  {
    id: "deepseek-reasoning-family",
    match: /(reasoner|deepseek-r1|deepseek-v4|\bv4\b)/i,
    metadata: {
      contextWindowTokens: 128_000,
    },
  },
  {
    id: "deepseek:reasoning-family",
    providers: ["deepseek"],
    match: /(reasoner|deepseek-r1|deepseek-v4|\bv4\b)/i,
    metadata: {
      reasoning: DEEPSEEK_REASONING,
    },
  },
  {
    id: "minimax:m2",
    providers: ["minimax"],
    match: /(minimax.*m2|m2\.)/i,
    metadata: {
      contextWindowTokens: 128_000,
      reasoning: MINIMAX_RAW_REASONING,
    },
  },
] satisfies readonly AiModelMetadataRule[];

const getModelRuleMatchCandidates = (modelId: string) => {
  const normalizedModelId = modelId.trim();
  if (!normalizedModelId) return [];

  const slashLeaf = normalizedModelId.split("/").at(-1)?.trim() || "";
  return slashLeaf && slashLeaf !== normalizedModelId
    ? [normalizedModelId, slashLeaf]
    : [normalizedModelId];
};

const matchesProviderRule = (
  providerId: AiProviderId,
  rule: AiModelMetadataRule,
) => !rule.providers || rule.providers.includes(providerId);

const matchesModelRule = (modelId: string, rule: string | RegExp) => {
  const candidates = getModelRuleMatchCandidates(modelId);
  if (candidates.length === 0) return false;
  return candidates.some((candidate) =>
    typeof rule === "string"
      ? candidate.toLowerCase() === rule.toLowerCase()
      : rule.test(candidate),
  );
};

const mergeReasoning = (
  base: AiModelReasoningMetadata,
  next?: AiModelReasoningMetadata,
): AiModelReasoningMetadata => (next ? { ...base, ...next } : base);

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
  let capabilities: AiModelCapabilityMetadata | undefined;
  let modelReasoning = NO_REASONING_CAPABILITY as AiModelReasoningMetadata;

  for (const rule of AI_MODEL_METADATA_RULES) {
    if (!matchesProviderRule(providerId, rule)) continue;
    if (!matchesModelRule(modelId, rule.match)) continue;
    const metadata: AiProviderModelMetadata = rule.metadata;
    if (metadata.contextWindowTokens) {
      contextWindowTokens = Math.max(
        1,
        Math.trunc(metadata.contextWindowTokens),
      );
    }
    capabilities = mergeCapabilityMetadata(capabilities, metadata.capabilities);
    modelReasoning = mergeReasoning(modelReasoning, metadata.reasoning);
  }

  return {
    providerId,
    modelId,
    contextWindowTokens,
    capabilities,
    reasoning: modelReasoning,
  };
};

export const getAiProviderModelReasoningMetadata = (
  providerId: AiProviderId,
  modelId: string,
) => resolveAiProviderModelMetadata(providerId, modelId).reasoning;

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

  return {
    inputModalities: [...inputModalities],
    outputModalities: [...outputModalities],
    supportsImageInput: inputModalities.includes("image"),
    supportsToolCalls,
    contextWindowTokens: metadata.contextWindowTokens,
  };
};
