import type {
  LLMCustomModelCapability,
  LLMModelCapabilities,
  LLMModelModality,
} from "@/types";

const DEFAULT_OUTPUT_MODALITIES: LLMModelModality[] = ["text"];

const matchAnyPattern = (value: string, patterns: readonly RegExp[]) =>
  patterns.some((pattern) => pattern.test(value));

const OPENAI_LIKE_IMAGE_PATTERNS: readonly RegExp[] = [
  /^gpt-4o(?:[-:]|$)/,
  /^gpt-4\.1(?:[-:]|$)/,
  /^gpt-4\.5(?:[-:]|$)/,
  /^gpt-5(?:[.:-]|$)/,
  /^gemini(?:[-._:]|$)/,
  /^claude(?:[-._:]|$)/,
  /(?:^|[-_/])(vision|vl)(?:[-_/]|$)/,
  /(?:^|[-_/])llama-4(?:[-_/]|$)/,
  /(?:^|[-_/])pixtral(?:[-_/]|$)/,
  /(?:^|[-_/])gemma-3(?:[-_/]|$)/,
  /(?:^|[-_/])minicpm[-_]?v(?:[-_/]|$)/,
  /(?:^|[-_/])phi-3\.5-vision(?:[-_/]|$)/,
  /(?:^|[-_/])qwen(?:2(?:\.5)?)?[-_]?vl(?:[-_/]|$)/,
  /(?:^|[-_/])internvl(?:[-_/]|$)/,
  /(?:^|[-_/])glm-(?:\d+(?:\.\d+)?)v(?:[-_/]|$)/,
  /(?:^|[-_/])kimi[-_]?vl(?:[-_/]|$)/,
];

const OPENAI_LIKE_NON_TOOL_PATTERNS: readonly RegExp[] = [
  /(?:^|[-_/])embedding(?:[-_/]|$)/,
  /(?:^|[-_/])moderation(?:[-_/]|$)/,
  /(?:^|[-_/])tts(?:[-_/]|$)/,
  /(?:^|[-_/])whisper(?:[-_/]|$)/,
  /(?:^|[-_/])transcription(?:[-_/]|$)/,
  /(?:^|[-_/])speech(?:[-_/]|$)/,
  /(?:^|[-_/])image(?:[-_/]|$)/,
];

const normalizeModalities = (
  values: readonly string[] | undefined,
): LLMModelModality[] => {
  const seen = new Set<string>();
  const normalized: LLMModelModality[] = [];

  for (const value of values ?? []) {
    const modality = value.trim().toLowerCase();
    if (!modality || seen.has(modality)) continue;
    seen.add(modality);
    normalized.push(modality as LLMModelModality);
  }

  return normalized;
};

export const createModelCapabilities = (options: {
  inputModalities?: readonly string[];
  outputModalities?: readonly string[];
  supportsToolCalls: boolean;
}): LLMModelCapabilities => {
  const inputModalities = normalizeModalities(options.inputModalities);
  const outputModalities = normalizeModalities(options.outputModalities);

  return {
    inputModalities,
    outputModalities:
      outputModalities.length > 0
        ? outputModalities
        : DEFAULT_OUTPUT_MODALITIES,
    supportsImageInput: inputModalities.includes("image"),
    supportsToolCalls: options.supportsToolCalls,
  };
};

export const createCustomModelCapabilities = (
  capabilities: readonly LLMCustomModelCapability[],
): LLMModelCapabilities => {
  const normalizedCapabilities = new Set<LLMCustomModelCapability>([
    "text",
    ...capabilities,
  ]);

  return createModelCapabilities({
    inputModalities: normalizedCapabilities.has("image")
      ? ["text", "image"]
      : ["text"],
    outputModalities: DEFAULT_OUTPUT_MODALITIES,
    supportsToolCalls: normalizedCapabilities.has("tools"),
  });
};

export const supportsOpenAiLikeImageInput = (
  modelId: string,
  extraPatterns: readonly RegExp[] = [],
) => {
  const normalizedModelId = modelId.trim().toLowerCase();
  if (!normalizedModelId) return false;

  return matchAnyPattern(normalizedModelId, [
    ...OPENAI_LIKE_IMAGE_PATTERNS,
    ...extraPatterns,
  ]);
};

export const supportsOpenAiLikeToolCalls = (
  modelId: string,
  extraNonToolPatterns: readonly RegExp[] = [],
) => {
  const normalizedModelId = modelId.trim().toLowerCase();
  if (!normalizedModelId) return true;

  return !matchAnyPattern(normalizedModelId, [
    ...OPENAI_LIKE_NON_TOOL_PATTERNS,
    ...extraNonToolPatterns,
  ]);
};

export const createOpenAiLikeModelCapabilities = (options: {
  modelId: string;
  extraImagePatterns?: readonly RegExp[];
  extraNonToolPatterns?: readonly RegExp[];
}) =>
  createModelCapabilities({
    inputModalities: supportsOpenAiLikeImageInput(
      options.modelId,
      options.extraImagePatterns,
    )
      ? ["text", "image"]
      : ["text"],
    outputModalities: DEFAULT_OUTPUT_MODALITIES,
    supportsToolCalls: supportsOpenAiLikeToolCalls(
      options.modelId,
      options.extraNonToolPatterns,
    ),
  });

export const modelSupportsInputModality = (
  capabilities: LLMModelCapabilities | undefined,
  modality: LLMModelModality,
) => {
  return Boolean(capabilities?.inputModalities.includes(modality));
};
