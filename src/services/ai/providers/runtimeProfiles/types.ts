import type { ModelMessage } from "ai";
import type { ProviderV3 } from "@ai-sdk/provider";

import type { AppOptions } from "@/types";
import type {
  AiSdkBackendKind,
  AiSdkModelCallOptions,
  AiSdkProviderConfig,
  AiSdkProviderId,
  AiSdkTaskModelKind,
} from "@/services/ai/providers/types";

export type AiReasoningMode = "auto" | "off" | "on";
export type AiReasoningEffort = "auto" | "low" | "medium" | "high";
export type AiReasoningReplayPolicy = "none" | "tool-calls" | "all";
export type AiReasoningDisplayPolicy =
  | "hidden"
  | "summary"
  | "full-if-provider-exposes";
export type AiReasoningTextExposure = "none" | "summary" | "raw";

export interface AiReasoningPreference {
  mode: AiReasoningMode;
  effort: AiReasoningEffort;
  budgetTokens?: number;
  displayPolicy: AiReasoningDisplayPolicy;
}

export interface AiReasoningCapability {
  supported: boolean;
  supportsModeSwitch: boolean;
  supportsEffort: boolean;
  supportsBudgetTokens: boolean;
  textExposure: AiReasoningTextExposure;
  requiresReasoningReplay: AiReasoningReplayPolicy;
}

export interface AiProviderRuntimeRequest {
  providerId: AiSdkProviderId;
  backendKind: AiSdkBackendKind;
  apiOptionId?: string;
  modelId: string;
  task: AiSdkTaskModelKind;
  appOptions: AppOptions;
}

export interface AiProviderReasoningResolution {
  effectivePreference: AiReasoningPreference;
  capability: AiReasoningCapability;
  callOptions?: AiSdkModelCallOptions;
  replayPolicy: AiReasoningReplayPolicy;
}

export interface AiProviderRuntimeProfile {
  providerId: AiSdkProviderId;

  createProvider: (config: AiSdkProviderConfig) => ProviderV3;

  getReasoningCapability: (
    request: AiProviderRuntimeRequest,
  ) => AiReasoningCapability;

  resolveReasoning: (
    request: AiProviderRuntimeRequest & {
      preference: AiReasoningPreference;
    },
  ) => AiProviderReasoningResolution;

  prepareMessages?: (
    messages: ModelMessage[],
    request: AiProviderRuntimeRequest & {
      reasoning: AiProviderReasoningResolution;
    },
  ) => ModelMessage[];

  validateMessages?: (
    messages: ModelMessage[],
    request: AiProviderRuntimeRequest & {
      reasoning: AiProviderReasoningResolution;
    },
  ) => void;
}
