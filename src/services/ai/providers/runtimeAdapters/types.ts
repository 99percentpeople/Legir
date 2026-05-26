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

export type AiReasoningLevel =
  | "none"
  | "auto"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";
export type AiReasoningActiveLevel = Exclude<AiReasoningLevel, "none" | "auto">;
export type AiReasoningReplayPolicy = "none" | "tool-calls" | "all";
export type AiReasoningDisplayPolicy =
  | "hidden"
  | "summary"
  | "full-if-provider-exposes";
export type AiReasoningTextExposure = "none" | "summary" | "raw";
export type AiReasoningBudgetByLevel = Partial<
  Record<AiReasoningLevel, number>
>;

export interface AiReasoningPreference {
  level: AiReasoningLevel;
  displayPolicy: AiReasoningDisplayPolicy;
}

export interface AiReasoningCapability {
  supported: boolean;
  levels: readonly AiReasoningLevel[];
  budgetTokensByLevel?: AiReasoningBudgetByLevel;
  textExposure: AiReasoningTextExposure;
  requiresReasoningReplay: AiReasoningReplayPolicy;
}

export interface AiReasoningLevelControl {
  supported: boolean;
  levels: readonly AiReasoningLevel[];
  selectedLevel: AiReasoningLevel;
  showSelect: boolean;
}

export interface AiRuntimeRequest {
  providerId: AiSdkProviderId;
  backendKind: AiSdkBackendKind;
  apiOptionId?: string;
  modelId: string;
  task: AiSdkTaskModelKind;
  appOptions: AppOptions;
}

export interface AiReasoningResolution {
  effectivePreference: AiReasoningPreference;
  capability: AiReasoningCapability;
  callOptions?: AiSdkModelCallOptions;
  replayPolicy: AiReasoningReplayPolicy;
}

export interface AiRuntimeAdapter {
  providerId: AiSdkProviderId;

  /** Build the AI SDK provider, including provider-specific SDK wrappers. */
  createSdkProvider: (config: AiSdkProviderConfig) => ProviderV3;

  getReasoningCapability: (request: AiRuntimeRequest) => AiReasoningCapability;

  resolveReasoning: (
    request: AiRuntimeRequest & {
      preference: AiReasoningPreference;
    },
  ) => AiReasoningResolution;

  prepareMessages?: (
    messages: ModelMessage[],
    request: AiRuntimeRequest & {
      reasoning: AiReasoningResolution;
    },
  ) => ModelMessage[];

  validateMessages?: (
    messages: ModelMessage[],
    request: AiRuntimeRequest & {
      reasoning: AiReasoningResolution;
    },
  ) => void;
}
