import type { ProviderV3 } from "@ai-sdk/provider";

import type {
  AiSdkModelCallOptions,
  AiSdkProviderConfig,
} from "@/services/ai/providers/types";
import type {
  AiProviderReasoningResolution,
  AiProviderRuntimeProfile,
  AiProviderRuntimeRequest,
  AiReasoningCapability,
  AiReasoningDisplayPolicy,
  AiReasoningEffort,
  AiReasoningMode,
  AiReasoningPreference,
} from "@/services/ai/providers/runtimeProfiles/types";

export const DEFAULT_REASONING_PREFERENCE: AiReasoningPreference = {
  mode: "auto",
  effort: "auto",
  displayPolicy: "summary",
};

export const NO_REASONING_CAPABILITY: AiReasoningCapability = {
  supported: false,
  supportsModeSwitch: false,
  supportsEffort: false,
  supportsBudgetTokens: false,
  textExposure: "none",
  requiresReasoningReplay: "none",
};

export const normalizeReasoningPreference = (
  value: Partial<AiReasoningPreference> | null | undefined,
): AiReasoningPreference => {
  const mode: AiReasoningMode =
    value?.mode === "on" || value?.mode === "off" || value?.mode === "auto"
      ? value.mode
      : DEFAULT_REASONING_PREFERENCE.mode;
  const effort: AiReasoningEffort =
    value?.effort === "low" ||
    value?.effort === "medium" ||
    value?.effort === "high" ||
    value?.effort === "auto"
      ? value.effort
      : DEFAULT_REASONING_PREFERENCE.effort;
  const displayPolicy: AiReasoningDisplayPolicy =
    value?.displayPolicy === "hidden" ||
    value?.displayPolicy === "summary" ||
    value?.displayPolicy === "full-if-provider-exposes"
      ? value.displayPolicy
      : DEFAULT_REASONING_PREFERENCE.displayPolicy;
  const budgetTokens =
    typeof value?.budgetTokens === "number" &&
    Number.isFinite(value.budgetTokens) &&
    value.budgetTokens > 0
      ? Math.trunc(value.budgetTokens)
      : undefined;

  return {
    mode,
    effort,
    displayPolicy,
    budgetTokens,
  };
};

export const getAiChatReasoningPreference = (
  request: Pick<AiProviderRuntimeRequest, "appOptions">,
) => normalizeReasoningPreference(request.appOptions.aiChat.reasoning);

export const createNoReasoningResolution = (options: {
  preference: AiReasoningPreference;
  capability?: AiReasoningCapability;
}): AiProviderReasoningResolution => ({
  capability: options.capability ?? NO_REASONING_CAPABILITY,
  effectivePreference: {
    ...options.preference,
    mode: "off",
    effort: "auto",
  },
  replayPolicy: "none",
});

export const canDisplayReasoningText = (
  resolution: AiProviderReasoningResolution,
) =>
  resolution.effectivePreference.mode !== "off" &&
  resolution.effectivePreference.displayPolicy !== "hidden" &&
  resolution.capability.textExposure !== "none";

export const canPreviewCollapsedReasoningText = (
  resolution: AiProviderReasoningResolution,
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

export const createConservativeRuntimeProfile = (options: {
  providerId: AiProviderRuntimeProfile["providerId"];
  createProvider: (config: AiSdkProviderConfig) => ProviderV3;
}): AiProviderRuntimeProfile => ({
  providerId: options.providerId,
  createProvider: options.createProvider,
  getReasoningCapability: () => NO_REASONING_CAPABILITY,
  resolveReasoning: ({ preference }) =>
    createNoReasoningResolution({ preference }),
});
