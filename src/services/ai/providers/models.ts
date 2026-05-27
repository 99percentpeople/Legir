import type { AiProviderId } from "@/services/ai/providers/catalog";
import {
  createModelCapabilities,
  createOpenAiLikeModelCapabilities,
} from "@/services/ai/providers/capabilities";
import type { AiReasoningCapability } from "@/services/ai/providers/runtimeAdapters/types";
import type { AiSdkDiscoveredModel } from "@/services/ai/providers/types";
import type { LLMModelModality } from "@/types";

export type AiReasoningOffStrategy =
  | "none"
  | "provider-switch"
  | "gemini-thinking-budget-zero"
  | "openai-reasoning-effort-none";

export type AiModelReasoningMetadata = AiReasoningCapability & {
  offStrategy?: AiReasoningOffStrategy;
};

export type AiModelCapabilityMetadata = {
  inputModalities?: readonly LLMModelModality[];
  outputModalities?: readonly LLMModelModality[];
  supportsToolCalls?: boolean;
  supportsImageToolResults?: boolean;
};

export type AiModelMetadata = {
  contextWindowTokens?: number;
  capabilities?: AiModelCapabilityMetadata;
  reasoning?: AiModelReasoningMetadata;
};

export type AiModelAvailability = {
  providerId: AiProviderId;
  /** Curated model ids to expose for this provider; defaults to entry.modelIds. */
  modelIds?: readonly string[];
  label?: string;
  apiOptionIds?: readonly string[];
  baseUrlHosts?: readonly string[];
  inputModalities?: readonly string[];
  outputModalities?: readonly string[];
  supportsToolCalls?: boolean;
  supportsImageToolResults?: boolean;
};

export type AiModelEntry = {
  /** Stable rule id for debugging and maintenance. It is never used to match model ids. */
  id: string;
  /** Exact model ids covered by this rule and used for curated model lists. */
  modelIds?: readonly string[];
  /** Family or alias patterns covered by this rule. */
  patterns?: readonly RegExp[];
  providers?: readonly AiProviderId[];
  metadata?: AiModelMetadata;
  availability?: readonly AiModelAvailability[];
};

type CreateAiDiscoveredModelOptions = {
  modelId: string;
  label?: string;
  capabilities?: AiSdkDiscoveredModel["capabilities"];
  inputModalities?: readonly string[];
  outputModalities?: readonly string[];
  supportsToolCalls?: boolean;
  supportsImageToolResults?: boolean;
  contextWindowTokens?: number;
};

const OFFICIAL_OPENAI_BASE_URL_HOSTS = ["api.openai.com"] as const;
const GEMINI_2_TEXT_MODEL_PATTERN =
  /^gemini-2\.0-flash(?:$|-001|-lite(?:$|-001))/i;
const GEMINI_2_5_TEXT_MODEL_PATTERN =
  /^gemini-2\.5-(?:pro|flash(?:-lite)?)(?:$|-preview)/i;
const GEMINI_2_5_PRO_MODEL_PATTERN = /^gemini-2\.5-pro(?:$|-preview)/i;
const GEMINI_2_5_FLASH_MODEL_PATTERN =
  /^gemini-2\.5-flash(?:-lite)?(?:$|-preview)/i;
const GEMINI_2_5_LEGACY_PREVIEW_MODEL_PATTERN =
  /^gemini-2\.5-(?:pro|flash(?:-lite)?)-preview-\d{2}-\d{4}$/i;
const GEMINI_3_TEXT_MODEL_PATTERN =
  /^gemini-(?:3\.5-flash|3\.1-(?:pro-preview(?:-customtools)?|flash-lite(?:-preview)?)|3-flash-preview)(?:$|-)/i;
const GEMINI_3_PRO_MODEL_PATTERN =
  /^gemini-3\.1-pro-preview(?:-customtools)?(?:$|-)/i;
const GEMINI_3_FLASH_MODEL_PATTERN =
  /^gemini-(?:3\.5-flash|3\.1-flash-lite(?:-preview)?|3-flash-preview)(?:$|-)/i;
const GEMINI_TEXT_MODEL_PATTERN =
  /^gemini-(?:3\.5-flash|3\.1-(?:pro-preview(?:-customtools)?|flash-lite(?:-preview)?)|3-flash-preview|2\.5-(?:pro|flash(?:-lite)?)(?:$|-preview)|2\.0-flash(?:$|-001|-lite(?:$|-001)))/i;

const textImageTools: AiModelCapabilityMetadata = {
  inputModalities: ["text", "image"],
  outputModalities: ["text"],
  supportsToolCalls: true,
};

const textTools: AiModelCapabilityMetadata = {
  inputModalities: ["text"],
  outputModalities: ["text"],
  supportsToolCalls: true,
};

const fullModalTools: AiModelCapabilityMetadata = {
  inputModalities: ["text", "image", "audio", "video", "file"],
  outputModalities: ["text"],
  supportsToolCalls: true,
};

const zhipuVisionNoTools: AiModelCapabilityMetadata = {
  inputModalities: ["text", "image", "file", "video"],
  outputModalities: ["text"],
  supportsToolCalls: false,
};

const zhipuVisionTools: AiModelCapabilityMetadata = {
  inputModalities: ["text", "image", "file", "video"],
  outputModalities: ["text"],
  supportsToolCalls: true,
};

const imageToolResults: AiModelCapabilityMetadata = {
  supportsImageToolResults: true,
};

const noToolCalls: AiModelCapabilityMetadata = {
  supportsToolCalls: false,
};

const openAiImageToolResultAvailability = () =>
  availableOn("openai", {
    baseUrlHosts: OFFICIAL_OPENAI_BASE_URL_HOSTS,
    supportsImageToolResults: true,
  });

const reasoning = (
  value: Omit<AiModelReasoningMetadata, "supported">,
): AiModelReasoningMetadata => ({
  supported: true,
  ...value,
});

const OPENAI_REASONING: AiModelReasoningMetadata = reasoning({
  levels: ["auto", "low", "medium", "high"],
  textExposure: "none",
  requiresReasoningReplay: "none",
});

const OPENAI_REASONING_WITH_NONE: AiModelReasoningMetadata = {
  ...OPENAI_REASONING,
  levels: ["none", "auto", "low", "medium", "high"],
  offStrategy: "openai-reasoning-effort-none",
};

const NO_REASONING: AiModelReasoningMetadata = {
  supported: false,
  levels: [],
  textExposure: "none",
  requiresReasoningReplay: "none",
};

const OPENAI_GPT5_REASONING: AiModelReasoningMetadata = {
  ...OPENAI_REASONING,
  levels: ["auto", "minimal", "low", "medium", "high"],
};

const OPENAI_REASONING_WITH_XHIGH: AiModelReasoningMetadata = {
  ...OPENAI_REASONING,
  levels: ["auto", "low", "medium", "high", "xhigh"],
  offStrategy: "none",
};

const OPENAI_REASONING_HIGH_ONLY: AiModelReasoningMetadata = {
  ...OPENAI_REASONING,
  levels: ["high"],
  offStrategy: "none",
};

const OPENAI_REASONING_WITH_NONE_XHIGH: AiModelReasoningMetadata = {
  ...OPENAI_REASONING_WITH_NONE,
  levels: ["none", "auto", "low", "medium", "high", "xhigh"],
};

const BUDGET_TOKENS_BY_LEVEL = {
  auto: 4096,
  low: 1024,
  medium: 4096,
  high: 8192,
} as const;

const GEMINI_2_5_BUDGET_TOKENS_BY_LEVEL = {
  low: 1024,
  medium: 4096,
  high: 8192,
} as const;

// Gemini 2.5 uses token budgets, while Gemini 3 uses thinkingLevel.
// 2.5 Pro does not expose a disable-thinking budget, but Flash variants do.
const GEMINI_2_5_PRO_REASONING: AiModelReasoningMetadata = reasoning({
  levels: ["auto", "low", "medium", "high"],
  budgetTokensByLevel: GEMINI_2_5_BUDGET_TOKENS_BY_LEVEL,
  textExposure: "summary",
  requiresReasoningReplay: "none",
});

const GEMINI_2_5_FLASH_REASONING: AiModelReasoningMetadata = reasoning({
  levels: ["none", "auto", "low", "medium", "high"],
  budgetTokensByLevel: GEMINI_2_5_BUDGET_TOKENS_BY_LEVEL,
  offStrategy: "gemini-thinking-budget-zero",
  textExposure: "summary",
  requiresReasoningReplay: "none",
});

const GEMINI_3_PRO_REASONING: AiModelReasoningMetadata = reasoning({
  levels: ["auto", "low", "medium", "high"],
  textExposure: "summary",
  requiresReasoningReplay: "none",
});

const GEMINI_3_FLASH_REASONING: AiModelReasoningMetadata = reasoning({
  levels: ["auto", "minimal", "low", "medium", "high"],
  textExposure: "summary",
  requiresReasoningReplay: "none",
});

// DeepSeek exposes high/max effort; xhigh is the app-level alias for max.
const DEEPSEEK_REASONING: AiModelReasoningMetadata = reasoning({
  levels: ["none", "auto", "high", "xhigh"],
  offStrategy: "provider-switch",
  textExposure: "raw",
  requiresReasoningReplay: "tool-calls",
});

const MIMO_REASONING: AiModelReasoningMetadata = reasoning({
  levels: ["none", "auto"],
  offStrategy: "provider-switch",
  textExposure: "raw",
  requiresReasoningReplay: "tool-calls",
});

const ZHIPU_REASONING: AiModelReasoningMetadata = reasoning({
  levels: ["none", "auto"],
  offStrategy: "provider-switch",
  textExposure: "raw",
  requiresReasoningReplay: "none",
});

const ANTHROPIC_REASONING: AiModelReasoningMetadata = reasoning({
  levels: ["none", "auto", "low", "medium", "high"],
  budgetTokensByLevel: BUDGET_TOKENS_BY_LEVEL,
  textExposure: "summary",
  requiresReasoningReplay: "all",
});

const ANTHROPIC_ADAPTIVE_REASONING: AiModelReasoningMetadata = reasoning({
  levels: ["none", "auto", "low", "medium", "high", "xhigh"],
  budgetTokensByLevel: undefined,
  providerMode: "anthropic-adaptive",
  textExposure: "summary",
  requiresReasoningReplay: "all",
});

const MINIMAX_RAW_REASONING: AiModelReasoningMetadata = {
  ...ANTHROPIC_REASONING,
  textExposure: "raw",
};

const model = (entry: AiModelEntry): AiModelEntry => entry;

const availableOn = (
  providerId: AiProviderId,
  options: Omit<AiModelAvailability, "providerId"> = {},
): AiModelAvailability => ({
  providerId,
  ...options,
});

export const AI_MODELS = [
  model({
    id: "gpt-4.1",
    modelIds: ["gpt-4.1"],
    patterns: [/^gpt-4\.1/i],
    availability: [openAiImageToolResultAvailability()],
    metadata: {
      contextWindowTokens: 1_000_000,
      capabilities: textImageTools,
    },
  }),
  model({
    id: "gpt-5.1",
    modelIds: ["gpt-5.1"],
    patterns: [/^gpt-5\.1/i],
    availability: [openAiImageToolResultAvailability()],
    metadata: {
      contextWindowTokens: 400_000,
      capabilities: textImageTools,
    },
  }),
  model({
    id: "openai:gpt-5.1-reasoning",
    providers: ["openai"],
    patterns: [/^gpt-5\.1/i],
    metadata: {
      reasoning: OPENAI_REASONING_WITH_NONE,
    },
  }),
  model({
    id: "gpt-5",
    modelIds: ["gpt-5"],
    patterns: [/^gpt-5(?:$|-)/i],
    availability: [openAiImageToolResultAvailability()],
    metadata: {
      contextWindowTokens: 400_000,
      capabilities: textImageTools,
    },
  }),
  model({
    id: "openai:gpt-5-reasoning",
    providers: ["openai"],
    patterns: [/^gpt-5(?:$|-)/i],
    metadata: {
      reasoning: OPENAI_GPT5_REASONING,
    },
  }),
  model({
    id: "gpt-5-pro",
    patterns: [/^gpt-5-pro/i],
    metadata: {
      contextWindowTokens: 400_000,
    },
  }),
  model({
    id: "openai:gpt-5-pro-reasoning",
    providers: ["openai"],
    patterns: [/^gpt-5-pro/i],
    metadata: {
      reasoning: OPENAI_REASONING_HIGH_ONLY,
    },
  }),
  model({
    id: "gpt-5.2",
    modelIds: ["gpt-5.2"],
    patterns: [/^gpt-5\.2/i],
    availability: [openAiImageToolResultAvailability()],
    metadata: {
      contextWindowTokens: 400_000,
      capabilities: textImageTools,
    },
  }),
  model({
    id: "openai:gpt-5.2-reasoning",
    providers: ["openai"],
    patterns: [/^gpt-5\.2/i],
    metadata: {
      reasoning: OPENAI_REASONING_WITH_NONE_XHIGH,
    },
  }),
  model({
    id: "openai:gpt-5.2-pro-reasoning",
    providers: ["openai"],
    patterns: [/^gpt-5\.2-pro/i],
    metadata: {
      reasoning: OPENAI_REASONING_WITH_XHIGH,
    },
  }),
  model({
    id: "openai:gpt-5.2-codex-reasoning",
    providers: ["openai"],
    patterns: [/^gpt-5\.2-codex/i],
    metadata: {
      reasoning: OPENAI_REASONING_WITH_XHIGH,
    },
  }),
  model({
    id: "gpt-5.3-codex",
    patterns: [/^gpt-5\.3-codex/i],
    metadata: {
      contextWindowTokens: 400_000,
      capabilities: textImageTools,
    },
  }),
  model({
    id: "openai:gpt-5.3-codex-reasoning",
    providers: ["openai"],
    patterns: [/^gpt-5\.3-codex/i],
    metadata: {
      reasoning: OPENAI_REASONING_WITH_XHIGH,
    },
  }),
  model({
    id: "gpt-5.4",
    modelIds: ["gpt-5.4"],
    patterns: [/^gpt-5\.4(?!-(?:mini|nano)(?:[-:]|$))/i],
    availability: [openAiImageToolResultAvailability()],
    metadata: {
      contextWindowTokens: 1_050_000,
      capabilities: textImageTools,
    },
  }),
  model({
    id: "openai:gpt-5.4-reasoning",
    providers: ["openai"],
    patterns: [/^gpt-5\.4(?!-(?:mini|nano)(?:[-:]|$))/i],
    metadata: {
      reasoning: OPENAI_REASONING_WITH_NONE_XHIGH,
    },
  }),
  model({
    id: "openai:gpt-5.4-pro-reasoning",
    providers: ["openai"],
    patterns: [/^gpt-5\.4-pro/i],
    metadata: {
      reasoning: OPENAI_REASONING_WITH_XHIGH,
    },
  }),
  model({
    id: "gpt-5.4-mini",
    modelIds: ["gpt-5.4-mini"],
    patterns: [/^gpt-5\.4-mini/i],
    availability: [openAiImageToolResultAvailability()],
    metadata: {
      contextWindowTokens: 400_000,
      capabilities: textImageTools,
    },
  }),
  model({
    id: "openai:gpt-5.4-mini-reasoning",
    providers: ["openai"],
    patterns: [/^gpt-5\.4-mini/i],
    metadata: {
      reasoning: OPENAI_REASONING_WITH_NONE_XHIGH,
    },
  }),
  model({
    id: "gpt-5.4-nano",
    modelIds: ["gpt-5.4-nano"],
    patterns: [/^gpt-5\.4-nano/i],
    availability: [openAiImageToolResultAvailability()],
    metadata: {
      contextWindowTokens: 400_000,
      capabilities: textImageTools,
    },
  }),
  model({
    id: "openai:gpt-5.4-nano-reasoning",
    providers: ["openai"],
    patterns: [/^gpt-5\.4-nano/i],
    metadata: {
      reasoning: OPENAI_REASONING_WITH_NONE_XHIGH,
    },
  }),
  model({
    id: "gpt-5.5",
    modelIds: ["gpt-5.5"],
    patterns: [/^gpt-5\.5/i],
    availability: [openAiImageToolResultAvailability()],
    metadata: {
      contextWindowTokens: 1_050_000,
      capabilities: textImageTools,
    },
  }),
  model({
    id: "openai:gpt-5.5-reasoning",
    providers: ["openai"],
    patterns: [/^gpt-5\.5/i],
    metadata: {
      reasoning: OPENAI_REASONING_WITH_NONE_XHIGH,
    },
  }),
  model({
    id: "gpt-5-chat",
    patterns: [/^gpt-5(?:\.\d+)?-chat-latest/i],
    metadata: {
      contextWindowTokens: 128_000,
      capabilities: textImageTools,
      reasoning: NO_REASONING,
    },
  }),
  model({
    id: "chat-latest",
    modelIds: ["chat-latest"],
    availability: [openAiImageToolResultAvailability()],
    metadata: {
      contextWindowTokens: 400_000,
      capabilities: textImageTools,
    },
  }),
  model({
    id: "openai-reasoning-family",
    patterns: [/^(o\d|codex|computer-use|reasoning)/i],
    metadata: {
      contextWindowTokens: 200_000,
    },
  }),
  model({
    id: "openai:reasoning-family",
    providers: ["openai"],
    patterns: [/^(o\d|codex|computer-use|reasoning)/i],
    metadata: {
      reasoning: OPENAI_REASONING,
    },
  }),
  model({
    id: "gpt-4.5",
    modelIds: ["gpt-4.5"],
    patterns: [/^gpt-4\.5/i],
    availability: [openAiImageToolResultAvailability()],
    metadata: {
      contextWindowTokens: 128_000,
      capabilities: textImageTools,
    },
  }),
  model({
    id: "gpt-4o",
    modelIds: ["gpt-4o"],
    patterns: [/^gpt-4o/i],
    availability: [openAiImageToolResultAvailability()],
    metadata: {
      contextWindowTokens: 128_000,
      capabilities: textImageTools,
    },
  }),
  model({
    id: "xiaomi-mimo:v2.5-pro-family",
    modelIds: ["mimo-v2.5-pro", "mimo-v2-pro"],
    providers: ["xiaomi-mimo"],
    metadata: {
      contextWindowTokens: 1_000_000,
      capabilities: textTools,
      reasoning: MIMO_REASONING,
    },
    availability: [availableOn("xiaomi-mimo")],
  }),
  model({
    id: "xiaomi-mimo:v2.5",
    modelIds: ["mimo-v2.5"],
    providers: ["xiaomi-mimo"],
    metadata: {
      contextWindowTokens: 1_000_000,
      capabilities: fullModalTools,
      reasoning: MIMO_REASONING,
    },
    availability: [availableOn("xiaomi-mimo")],
  }),
  model({
    id: "xiaomi-mimo:v2-omni",
    modelIds: ["mimo-v2-omni"],
    providers: ["xiaomi-mimo"],
    metadata: {
      contextWindowTokens: 256_000,
      capabilities: fullModalTools,
      reasoning: MIMO_REASONING,
    },
    availability: [availableOn("xiaomi-mimo")],
  }),
  model({
    id: "xiaomi-mimo:v2-flash",
    modelIds: ["mimo-v2-flash"],
    providers: ["xiaomi-mimo"],
    metadata: {
      contextWindowTokens: 256_000,
      capabilities: textTools,
      reasoning: MIMO_REASONING,
    },
    availability: [availableOn("xiaomi-mimo")],
  }),
  model({
    id: "claude",
    patterns: [/^claude/i],
    metadata: {
      contextWindowTokens: 200_000,
      capabilities: textImageTools,
    },
  }),
  model({
    id: "anthropic:claude-reasoning",
    providers: ["anthropic", "anthropic-compatible"],
    patterns: [/^claude-(?:(?:haiku|opus|sonnet)-4|3-7-sonnet)/i],
    metadata: {
      reasoning: ANTHROPIC_REASONING,
    },
  }),
  model({
    id: "anthropic:claude-opus-4.7-adaptive-thinking",
    providers: ["anthropic", "anthropic-compatible"],
    patterns: [/^claude-opus-4[-.]7/i],
    metadata: {
      reasoning: ANTHROPIC_ADAPTIVE_REASONING,
    },
  }),
  model({
    id: "anthropic:claude-image-tool-results",
    providers: ["anthropic", "anthropic-compatible"],
    patterns: [/^claude/i],
    metadata: {
      capabilities: imageToolResults,
    },
  }),
  model({
    id: "gemini:curated-3-pro-text",
    modelIds: ["gemini-3.1-pro-preview", "gemini-3.1-pro-preview-customtools"],
    providers: ["gemini"],
    metadata: {
      contextWindowTokens: 1_048_576,
      capabilities: textImageTools,
      reasoning: GEMINI_3_PRO_REASONING,
    },
    availability: [availableOn("gemini")],
  }),
  model({
    id: "gemini:curated-3-flash-text",
    modelIds: [
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
      "gemini-3-flash-preview",
    ],
    providers: ["gemini"],
    metadata: {
      contextWindowTokens: 1_048_576,
      capabilities: textImageTools,
      reasoning: GEMINI_3_FLASH_REASONING,
    },
    availability: [availableOn("gemini")],
  }),
  model({
    id: "gemini:curated-2.5-pro-text",
    modelIds: ["gemini-2.5-pro"],
    providers: ["gemini"],
    metadata: {
      contextWindowTokens: 1_048_576,
      capabilities: textImageTools,
      reasoning: GEMINI_2_5_PRO_REASONING,
    },
    availability: [availableOn("gemini")],
  }),
  model({
    id: "gemini:curated-2.5-flash-text",
    modelIds: ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    providers: ["gemini"],
    metadata: {
      contextWindowTokens: 1_048_576,
      capabilities: textImageTools,
      reasoning: GEMINI_2_5_FLASH_REASONING,
    },
    availability: [availableOn("gemini")],
  }),
  model({
    id: "gemini-2.5:text-family",
    patterns: [GEMINI_2_5_TEXT_MODEL_PATTERN],
    metadata: {
      contextWindowTokens: 1_048_576,
      capabilities: textImageTools,
    },
  }),
  model({
    id: "gemini:gemini-2.5-pro-reasoning",
    providers: ["gemini"],
    patterns: [GEMINI_2_5_PRO_MODEL_PATTERN],
    metadata: {
      reasoning: GEMINI_2_5_PRO_REASONING,
    },
  }),
  model({
    id: "gemini:gemini-2.5-flash-reasoning",
    providers: ["gemini"],
    patterns: [GEMINI_2_5_FLASH_MODEL_PATTERN],
    metadata: {
      reasoning: GEMINI_2_5_FLASH_REASONING,
    },
  }),
  model({
    id: "gemini:gemini-2.5-legacy-preview",
    patterns: [GEMINI_2_5_LEGACY_PREVIEW_MODEL_PATTERN],
    metadata: {
      contextWindowTokens: 1_048_576,
      capabilities: textImageTools,
    },
  }),
  model({
    id: "gemini-2.0:text-family",
    patterns: [GEMINI_2_TEXT_MODEL_PATTERN],
    metadata: {
      contextWindowTokens: 1_048_576,
      capabilities: textImageTools,
    },
  }),
  model({
    id: "gemini-3:text-family",
    patterns: [GEMINI_3_TEXT_MODEL_PATTERN],
    metadata: {
      contextWindowTokens: 1_048_576,
      capabilities: textImageTools,
    },
  }),
  model({
    id: "gemini:gemini-3-pro-reasoning",
    providers: ["gemini"],
    patterns: [GEMINI_3_PRO_MODEL_PATTERN],
    metadata: {
      reasoning: GEMINI_3_PRO_REASONING,
    },
  }),
  model({
    id: "gemini:gemini-3-flash-reasoning",
    providers: ["gemini"],
    patterns: [GEMINI_3_FLASH_MODEL_PATTERN],
    metadata: {
      reasoning: GEMINI_3_FLASH_REASONING,
    },
  }),
  model({
    id: "gemini:image-tool-results",
    providers: ["gemini"],
    patterns: [GEMINI_TEXT_MODEL_PATTERN],
    metadata: {
      capabilities: imageToolResults,
    },
  }),
  model({
    id: "deepseek-reasoning-family",
    patterns: [/(reasoner|deepseek-r1|deepseek-v4|\bv4\b)/i],
    metadata: {
      contextWindowTokens: 128_000,
    },
  }),
  model({
    id: "deepseek:reasoning-family",
    providers: ["deepseek"],
    patterns: [/(reasoner|deepseek-r1|deepseek-v4|\bv4\b)/i],
    metadata: {
      reasoning: DEEPSEEK_REASONING,
    },
  }),
  model({
    id: "openai-like:vision-family",
    patterns: [
      /(?:^|[-_/])(?:(?:vision|vl)|llama-4|pixtral|gemma-3|minicpm[-_]?v|phi-3\.5-vision|qwen(?:2(?:\.5)?)?[-_]?vl|internvl|glm-(?:\d+(?:\.\d+)?)v|kimi[-_]?vl)(?:[-_/]|$)/i,
    ],
    metadata: {
      capabilities: textImageTools,
    },
  }),
  model({
    id: "zhipu:vision-family",
    providers: ["zhipu"],
    patterns: [/(?:^|[-_/])glm-(?:\d+(?:\.\d+)?)v(?:[-_/]|$)/i],
    metadata: {
      capabilities: zhipuVisionNoTools,
    },
  }),
  model({
    id: "zhipu:glm-5-family",
    modelIds: ["glm-5.1", "glm-5.1-highspeed", "glm-5-turbo", "glm-5"],
    providers: ["zhipu"],
    patterns: [/^glm-5(?:\.1|-turbo|$)/i],
    metadata: {
      contextWindowTokens: 200_000,
      capabilities: textTools,
      reasoning: ZHIPU_REASONING,
    },
    availability: [availableOn("zhipu")],
  }),
  model({
    id: "zhipu:glm-4.7",
    modelIds: ["glm-4.7", "glm-4.7-flash", "glm-4.7-flashx"],
    providers: ["zhipu"],
    patterns: [/^glm-4\.7/i],
    metadata: {
      contextWindowTokens: 200_000,
      capabilities: textTools,
      reasoning: ZHIPU_REASONING,
    },
    availability: [availableOn("zhipu")],
  }),
  model({
    id: "zhipu:glm-4.6",
    modelIds: ["glm-4.6"],
    providers: ["zhipu"],
    patterns: [/^glm-4\.6(?:$|[-_])/i],
    metadata: {
      contextWindowTokens: 200_000,
      capabilities: textTools,
      reasoning: ZHIPU_REASONING,
    },
    availability: [availableOn("zhipu")],
  }),
  model({
    id: "zhipu:glm-4.5",
    modelIds: [
      "glm-4.5",
      "glm-4.5-air",
      "glm-4.5-x",
      "glm-4.5-airx",
      "glm-4.5-flash",
    ],
    providers: ["zhipu"],
    patterns: [/^glm-4\.5(?:$|[-_])/i],
    metadata: {
      capabilities: textTools,
      reasoning: ZHIPU_REASONING,
    },
    availability: [availableOn("zhipu")],
  }),
  model({
    id: "zhipu:glm-5v",
    modelIds: ["glm-5v-turbo"],
    providers: ["zhipu"],
    patterns: [/^glm-5v/i],
    metadata: {
      contextWindowTokens: 200_000,
      capabilities: zhipuVisionTools,
      reasoning: ZHIPU_REASONING,
    },
    availability: [availableOn("zhipu")],
  }),
  model({
    id: "zhipu:glm-4.6v",
    modelIds: ["glm-4.6v", "glm-4.6v-flash", "glm-4.6v-flashx"],
    providers: ["zhipu"],
    patterns: [/^glm-4\.6v/i],
    metadata: {
      contextWindowTokens: 128_000,
      capabilities: zhipuVisionTools,
      reasoning: ZHIPU_REASONING,
    },
    availability: [availableOn("zhipu")],
  }),
  model({
    id: "zhipu:glm-4.5v",
    modelIds: ["glm-4.5v"],
    providers: ["zhipu"],
    patterns: [/^glm-4\.5v/i],
    metadata: {
      contextWindowTokens: 64_000,
      capabilities: zhipuVisionNoTools,
      reasoning: ZHIPU_REASONING,
    },
    availability: [availableOn("zhipu")],
  }),
  model({
    id: "minimax:m2",
    modelIds: [
      "MiniMax-M2.7",
      "MiniMax-M2.7-highspeed",
      "MiniMax-M2.5",
      "MiniMax-M2.5-highspeed",
      "MiniMax-M2.1",
      "MiniMax-M2.1-highspeed",
      "MiniMax-M2",
    ],
    providers: ["minimax"],
    patterns: [/(minimax.*m2|m2\.)/i],
    metadata: {
      contextWindowTokens: 128_000,
      reasoning: MINIMAX_RAW_REASONING,
    },
    availability: [availableOn("minimax")],
  }),
  model({
    id: "groq:audio-family",
    providers: ["groq"],
    patterns: [/(?:^|[-_/])audio(?:[-_/]|$)/i],
    metadata: {
      capabilities: noToolCalls,
    },
  }),
  model({
    id: "openai-like:non-chat-family",
    patterns: [
      /(?:^|[-_/])(?:embedding|moderation|tts|whisper|transcription|speech|image)(?:[-_/]|$)/i,
    ],
    metadata: {
      capabilities: noToolCalls,
    },
  }),
] satisfies readonly AiModelEntry[];

const normalizeApiModalities = (values: readonly string[] | undefined) =>
  (values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean);

const hasCapabilityHints = (options: CreateAiDiscoveredModelOptions) =>
  !!options.capabilities ||
  !!options.inputModalities ||
  !!options.outputModalities ||
  typeof options.supportsToolCalls === "boolean" ||
  typeof options.supportsImageToolResults === "boolean";

const createHintedModelCapabilities = (
  options: CreateAiDiscoveredModelOptions,
) => {
  const inputModalities = normalizeApiModalities(options.inputModalities);
  const outputModalities = normalizeApiModalities(options.outputModalities);

  return createModelCapabilities({
    inputModalities: inputModalities.length > 0 ? inputModalities : ["text"],
    outputModalities: outputModalities.length > 0 ? outputModalities : ["text"],
    supportsToolCalls: options.supportsToolCalls ?? true,
    supportsImageToolResults: options.supportsImageToolResults,
    contextWindowTokens: options.contextWindowTokens,
  });
};

export const createAiDiscoveredModel = (
  options: CreateAiDiscoveredModelOptions,
): Required<Pick<AiSdkDiscoveredModel, "id" | "capabilities">> &
  Pick<AiSdkDiscoveredModel, "label"> => {
  const id = options.modelId.trim();

  return {
    id,
    label: options.label?.trim() || undefined,
    capabilities:
      options.capabilities ||
      (hasCapabilityHints(options)
        ? createHintedModelCapabilities(options)
        : createOpenAiLikeModelCapabilities({
            supportsImageToolResults: options.supportsImageToolResults,
            contextWindowTokens: options.contextWindowTokens,
          })),
  };
};

const getBaseUrlHost = (baseURL: string | undefined) => {
  if (!baseURL) return "";

  try {
    return new URL(baseURL).hostname.toLowerCase();
  } catch {
    return "";
  }
};

const matchesBaseUrlHosts = (
  baseURL: string | undefined,
  hosts: readonly string[] | undefined,
) => {
  if (!hosts || hosts.length === 0) return true;

  const host = getBaseUrlHost(baseURL);
  if (!host) return false;

  return hosts.some((candidate) => {
    const normalized = candidate.toLowerCase();
    return host === normalized || host.endsWith(`.${normalized}`);
  });
};

const matchesApiOption = (
  apiOptionId: string | undefined,
  apiOptionIds: readonly string[] | undefined,
) =>
  !apiOptionIds ||
  apiOptionIds.length === 0 ||
  apiOptionIds.includes(apiOptionId || "");

export const getCuratedAiProviderModels = (options: {
  providerId: AiProviderId;
  apiOptionId?: string;
  baseURL?: string;
}): AiSdkDiscoveredModel[] =>
  AI_MODELS.flatMap((entry) =>
    (entry.availability || []).flatMap((availability) => {
      const modelIds = availability.modelIds || entry.modelIds || [];
      return availability.providerId === options.providerId &&
        matchesApiOption(options.apiOptionId, availability.apiOptionIds) &&
        matchesBaseUrlHosts(options.baseURL, availability.baseUrlHosts)
        ? modelIds.map((modelId) => ({
            id: modelId,
            label: availability.label,
            inputModalities: availability.inputModalities,
            outputModalities: availability.outputModalities,
            supportsToolCalls: availability.supportsToolCalls,
            supportsImageToolResults: availability.supportsImageToolResults,
          }))
        : [];
    }),
  );
