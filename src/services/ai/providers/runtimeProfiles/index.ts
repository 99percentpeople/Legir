import type { ProviderV3 } from "@ai-sdk/provider";

import { anthropicRuntimeProfile } from "@/services/ai/providers/runtimeProfiles/anthropic";
import { deepseekRuntimeProfile } from "@/services/ai/providers/runtimeProfiles/deepseek";
import { geminiRuntimeProfile } from "@/services/ai/providers/runtimeProfiles/gemini";
import {
  minimaxAnthropicRuntimeProfile,
  minimaxOpenAiRuntimeProfile,
} from "@/services/ai/providers/runtimeProfiles/minimax";
import { openAiRuntimeProfile } from "@/services/ai/providers/runtimeProfiles/openai";
import {
  createOpenAiCompatibleRuntimeProfile,
  groqRuntimeProfile,
  openRouterRuntimeProfile,
  xaiRuntimeProfile,
  zhipuRuntimeProfile,
} from "@/services/ai/providers/runtimeProfiles/openaiCompatible";
import type { AiProviderRuntimeProfile } from "@/services/ai/providers/runtimeProfiles/types";
import type { AiSdkProviderConfig } from "@/services/ai/providers/types";

export * from "@/services/ai/providers/runtimeProfiles/types";
export {
  canDisplayReasoningText,
  canPreviewCollapsedReasoningText,
  DEFAULT_REASONING_PREFERENCE,
  getAiChatReasoningPreference,
  mergeAiSdkModelCallOptions,
  normalizeReasoningPreference,
} from "@/services/ai/providers/runtimeProfiles/shared";

const openAiCompatibleProfiles = new Map<string, AiProviderRuntimeProfile>();

const getOpenAiCompatibleProfile = (
  config: Pick<AiSdkProviderConfig, "providerId" | "backendKind">,
) => {
  const key = `${config.providerId}:${config.backendKind}`;
  const existing = openAiCompatibleProfiles.get(key);
  if (existing) return existing;
  const profile = createOpenAiCompatibleRuntimeProfile(config.providerId);
  openAiCompatibleProfiles.set(key, profile);
  return profile;
};

type StaticRuntimeBackendKind = Exclude<
  AiSdkProviderConfig["backendKind"],
  "openai-compatible"
>;

const STATIC_RUNTIME_PROFILES = {
  openai: openAiRuntimeProfile,
  anthropic: anthropicRuntimeProfile,
  google: geminiRuntimeProfile,
  deepseek: deepseekRuntimeProfile,
  "minimax-anthropic": minimaxAnthropicRuntimeProfile,
  "minimax-openai": minimaxOpenAiRuntimeProfile,
  openrouter: openRouterRuntimeProfile,
  groq: groqRuntimeProfile,
  xai: xaiRuntimeProfile,
  zhipu: zhipuRuntimeProfile,
} satisfies Record<StaticRuntimeBackendKind, AiProviderRuntimeProfile>;

export const getAiProviderRuntimeProfile = (
  config: Pick<AiSdkProviderConfig, "providerId" | "backendKind">,
): AiProviderRuntimeProfile => {
  if (config.backendKind === "openai-compatible") {
    return getOpenAiCompatibleProfile(config);
  }
  return STATIC_RUNTIME_PROFILES[config.backendKind];
};

export const createAiSdkProviderFromRuntimeProfile = (
  config: AiSdkProviderConfig,
): ProviderV3 => getAiProviderRuntimeProfile(config).createProvider(config);
