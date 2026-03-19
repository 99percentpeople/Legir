import type {
  LLMCustomModelCapability,
  LLMModelCapabilities,
  LLMModelModality,
} from "@/types";

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

export const modelSupportsInputModality = (
  capabilities: LLMModelCapabilities | undefined,
  modality: LLMModelModality,
) => {
  return Boolean(capabilities?.inputModalities.includes(modality));
};
