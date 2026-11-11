import type { ModelMessage } from "ai";

import type { AppOptions } from "@/types";
import type {
  AiSdkBackendKind,
  AiSdkProvider,
  AiSdkModelCallOptions,
  AiSdkProviderConfig,
  AiSdkProviderId,
  AiSdkTaskModelKind,
} from "@/services/ai/providers/types";

import type {
  AiReasoningReplayPolicy,
  AiReasoningPreference,
  AiReasoningCapability,
} from "../reasoningTypes";
export type {
  AiReasoningLevel,
  AiReasoningActiveLevel,
  AiReasoningReplayPolicy,
  AiReasoningDisplayPolicy,
  AiReasoningTextExposure,
  AiReasoningBudgetByLevel,
  AiReasoningPreference,
  AiReasoningCapability,
  AiReasoningLevelControl,
} from "../reasoningTypes";

export interface AiRuntimeRequest {
  providerId: AiSdkProviderId;
  /** Catalog identity is separate from the SDK option namespace and connection ID. */
  catalogId?: string;
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

  /** Whether this SDK transport accepts images inside tool results. */
  supportsImageToolResults?: boolean;

  /** Build the AI SDK provider, including provider-specific SDK wrappers. */
  createSdkProvider: (
    config: AiSdkProviderConfig,
  ) => AiSdkProvider | Promise<AiSdkProvider>;

  getReasoningCapability: (request: AiRuntimeRequest) => AiReasoningCapability;

  resolveReasoning: (
    request: AiRuntimeRequest & {
      preference: AiReasoningPreference;
    },
  ) => AiReasoningResolution;

  validateMessages?: (
    messages: ModelMessage[],
    request: AiRuntimeRequest & {
      reasoning: AiReasoningResolution;
    },
  ) => void;
}
