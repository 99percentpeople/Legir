import type { ProviderV3 } from "@ai-sdk/provider";

import type {
  AiSdkModelCallOptions,
  AiSdkProviderConfig,
} from "@/services/ai/providers/types";
import type {
  AiReasoningResolution,
  AiRuntimeAdapter,
  AiRuntimeRequest,
  AiReasoningActiveLevel,
  AiReasoningCapability,
  AiReasoningLevel,
  AiReasoningLevelControl,
  AiReasoningDisplayPolicy,
  AiReasoningPreference,
} from "@/services/ai/providers/runtimeAdapters/types";

export const DEFAULT_REASONING_PREFERENCE: AiReasoningPreference = {
  level: "auto",
  displayPolicy: "summary",
};

export const AI_REASONING_LEVELS: readonly AiReasoningLevel[] = [
  "none",
  "auto",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export const AI_REASONING_ACTIVE_LEVELS: readonly AiReasoningActiveLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export const NO_REASONING_CAPABILITY: AiReasoningCapability = {
  supported: false,
  levels: [],
  textExposure: "none",
  requiresReasoningReplay: "none",
};

export const isAiReasoningLevel = (value: unknown): value is AiReasoningLevel =>
  typeof value === "string" &&
  AI_REASONING_LEVELS.includes(value as AiReasoningLevel);

export const isAiReasoningActiveLevel = (
  value: unknown,
): value is AiReasoningActiveLevel =>
  typeof value === "string" &&
  AI_REASONING_ACTIVE_LEVELS.includes(value as AiReasoningActiveLevel);

export const normalizeReasoningPreference = (
  value: Partial<AiReasoningPreference> | null | undefined,
): AiReasoningPreference => {
  const level = isAiReasoningLevel(value?.level)
    ? value.level
    : DEFAULT_REASONING_PREFERENCE.level;
  const displayPolicy: AiReasoningDisplayPolicy =
    value?.displayPolicy === "hidden" ||
    value?.displayPolicy === "summary" ||
    value?.displayPolicy === "full-if-provider-exposes"
      ? value.displayPolicy
      : DEFAULT_REASONING_PREFERENCE.displayPolicy;

  return {
    level,
    displayPolicy,
  };
};

export const getSelectableReasoningLevels = (
  capability: AiReasoningCapability,
): readonly AiReasoningLevel[] => {
  if (!capability.supported) return [];

  const levels: AiReasoningLevel[] = [];
  for (const level of capability.levels) {
    if (!isAiReasoningLevel(level)) continue;
    if (!levels.includes(level)) {
      levels.push(level);
    }
  }
  return levels;
};

const selectActiveReasoningLevel = (
  capability: AiReasoningCapability,
  level: AiReasoningActiveLevel,
): AiReasoningActiveLevel | undefined => {
  const selectableLevels = getSelectableReasoningLevels(capability);
  const activeLevels = selectableLevels.filter(isAiReasoningActiveLevel);
  if (activeLevels.length === 0) return undefined;
  if (activeLevels.includes(level)) return level;

  const requestedIndex = AI_REASONING_ACTIVE_LEVELS.indexOf(level);
  for (let index = requestedIndex; index >= 0; index -= 1) {
    const fallback = AI_REASONING_ACTIVE_LEVELS[index];
    if (activeLevels.includes(fallback)) return fallback;
  }

  return activeLevels[0];
};

export const selectReasoningLevel = (
  capability: AiReasoningCapability,
  level: AiReasoningLevel,
): AiReasoningLevel => {
  const selectableLevels = getSelectableReasoningLevels(capability);
  if (selectableLevels.length === 0) return "none";
  if (selectableLevels.includes(level)) return level;

  if (isAiReasoningActiveLevel(level)) {
    const fallback = selectActiveReasoningLevel(capability, level);
    if (fallback) return fallback;
  }

  if (selectableLevels.includes("auto")) return "auto";
  return selectableLevels[0];
};

export const getReasoningBudgetTokensForLevel = (
  capability: AiReasoningCapability,
  level: AiReasoningLevel,
) => {
  const budgetTokens = capability.budgetTokensByLevel?.[level];
  return typeof budgetTokens === "number" &&
    Number.isFinite(budgetTokens) &&
    budgetTokens > 0
    ? Math.trunc(budgetTokens)
    : undefined;
};

export const getReasoningLevelControl = (
  capability: AiReasoningCapability,
  preference: AiReasoningPreference = DEFAULT_REASONING_PREFERENCE,
): AiReasoningLevelControl => {
  const levels = getSelectableReasoningLevels(capability);
  return {
    supported: capability.supported,
    levels,
    selectedLevel: selectReasoningLevel(capability, preference.level),
    showSelect: levels.length > 1,
  };
};

export const getAiChatReasoningPreference = (
  request: Pick<AiRuntimeRequest, "appOptions">,
) => normalizeReasoningPreference(request.appOptions.aiChat.reasoning);

export const createNoReasoningResolution = (options: {
  preference: AiReasoningPreference;
  capability?: AiReasoningCapability;
}): AiReasoningResolution => ({
  capability: options.capability ?? NO_REASONING_CAPABILITY,
  effectivePreference: {
    ...options.preference,
    level: "none",
  },
  replayPolicy: "none",
});

export const canDisplayReasoningText = (resolution: AiReasoningResolution) =>
  resolution.effectivePreference.level !== "none" &&
  resolution.effectivePreference.displayPolicy !== "hidden" &&
  resolution.capability.textExposure !== "none";

export const canPreviewCollapsedReasoningText = (
  resolution: AiReasoningResolution,
) =>
  canDisplayReasoningText(resolution) &&
  resolution.capability.textExposure === "raw";

export const mergeAiSdkModelCallOptions = (
  ...items: Array<AiSdkModelCallOptions | undefined>
): AiSdkModelCallOptions | undefined => {
  const providerOptions: NonNullable<AiSdkModelCallOptions["providerOptions"]> =
    {};

  for (const item of items) {
    if (!item?.providerOptions) continue;
    for (const [provider, value] of Object.entries(item.providerOptions)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        providerOptions[provider] = value;
        continue;
      }
      const previous = providerOptions[provider];
      providerOptions[provider] =
        previous && typeof previous === "object" && !Array.isArray(previous)
          ? {
              ...previous,
              ...value,
            }
          : value;
    }
  }

  return Object.keys(providerOptions).length > 0
    ? { providerOptions }
    : undefined;
};

/**
 * Creates a minimal runtime adapter for providers without app-controlled
 * reasoning mapping. The provider/model may still reason internally; this only
 * means Legir will not expose reasoning controls, replay policy, or provider
 * options until a provider-specific adapter implements them.
 */
export const createBasicRuntimeAdapter = (options: {
  providerId: AiRuntimeAdapter["providerId"];
  createSdkProvider: (config: AiSdkProviderConfig) => ProviderV3;
}): AiRuntimeAdapter => ({
  providerId: options.providerId,
  createSdkProvider: options.createSdkProvider,
  getReasoningCapability: () => NO_REASONING_CAPABILITY,
  resolveReasoning: ({ preference }) =>
    createNoReasoningResolution({ preference }),
});
