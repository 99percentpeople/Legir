import type {
  LLMCustomModelCapability,
  LLMModelCapabilities,
  LLMModelModality,
} from "@/types";
import { DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS } from "@/constants";

const DEFAULT_OUTPUT_MODALITIES: LLMModelModality[] = ["text"];

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
  supportsImageToolResults?: boolean;
  contextWindowTokens?: number;
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
    supportsImageToolResults: options.supportsImageToolResults === true,
    contextWindowTokens: Math.max(
      1,
      Math.trunc(
        options.contextWindowTokens || DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
      ),
    ),
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
    supportsImageToolResults: false,
  });
};

export const createOpenAiLikeModelCapabilities = (options: {
  supportsImageToolResults?: boolean;
  contextWindowTokens?: number;
}) =>
  createModelCapabilities({
    inputModalities: ["text"],
    outputModalities: DEFAULT_OUTPUT_MODALITIES,
    supportsToolCalls: true,
    supportsImageToolResults: options.supportsImageToolResults,
    contextWindowTokens: options.contextWindowTokens,
  });

export const modelSupportsInputModality = (
  capabilities: LLMModelCapabilities | undefined,
  modality: LLMModelModality,
) => {
  return Boolean(capabilities?.inputModalities.includes(modality));
};
