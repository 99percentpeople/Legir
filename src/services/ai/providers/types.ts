/**
 * AI provider adapter contracts.
 *
 * Keep provider configuration, model specifiers, and resolved SDK model types
 * here. Higher-level chat/task payloads should stay in their own feature
 * folders.
 */
import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";

import type { LLMModelOption } from "@/services/ai/types";
import type {
  AiProviderBackendKind,
  AiProviderId,
  AiProviderSpec,
} from "@/services/ai/providers/catalog";
import type {
  AiReasoningResolution,
  AiRuntimeAdapter,
  AiRuntimeRequest,
} from "@/services/ai/providers/runtimeAdapters/types";
import type { AppOptions, EditorState, LLMModelCapabilities } from "@/types";

export type AiSdkProviderId = AiProviderId;

export type AiSdkBackendKind = AiProviderBackendKind;

export interface AiSdkProviderConfig {
  providerId: AiSdkProviderId;
  label: string;
  backendKind: AiSdkBackendKind;
  apiOptionId?: string;
  apiKey: string;
  baseURL?: string;
  fetch?: FetchFunction;
}

export interface AiSdkModelSpecifier {
  providerId: AiSdkProviderId;
  modelId: string;
}

export interface AiSdkResolvedLanguageModel {
  specifier: AiSdkModelSpecifier;
  model: LanguageModel;
  callOptions?: AiSdkModelCallOptions;
}

export interface AiSdkResolvedRuntime extends AiSdkResolvedLanguageModel {
  adapter: AiRuntimeAdapter;
  reasoning: AiReasoningResolution;
  request: AiRuntimeRequest;
}

export type AiSdkTaskModelKind = "translate" | "vision" | "chat" | "summarize";

export interface AiSdkModelCallOptions {
  providerOptions?: SharedV3ProviderOptions;
}

export interface AiSdkDiscoveredModel {
  id: string;
  label?: string;
  capabilities?: LLMModelCapabilities;
  inputModalities?: readonly string[];
  outputModalities?: readonly string[];
  supportsToolCalls?: boolean;
  supportsImageToolResults?: boolean;
  contextWindowTokens?: number;
}

export interface AiSdkModelCatalogProviderRequest {
  appOptions: AppOptions;
  signal?: AbortSignal;
}

export interface AiSdkModelCatalogProviderTaskRequest {
  appOptions: AppOptions;
  modelCache: EditorState["llmModelCache"];
  kind: AiSdkTaskModelKind;
}

export interface AiSdkModelCatalogProviderCallOptionsRequest {
  modelId: string;
  kind: AiSdkTaskModelKind;
}

export interface AiSdkModelCatalogProvider {
  readonly providerId: AiSdkProviderId;
  fetchModels: (
    options: AiSdkModelCatalogProviderRequest,
  ) => Promise<LLMModelOption[]>;
  getModelsForTask: (
    options: AiSdkModelCatalogProviderTaskRequest,
  ) => LLMModelOption[];
  resolveCallOptions?: (
    options: AiSdkModelCatalogProviderCallOptionsRequest,
  ) => AiSdkModelCallOptions | undefined;
  checkConfig: (
    options: AiSdkModelCatalogProviderRequest,
  ) => Promise<void> | void;
}

export interface AiProviderDefinition {
  readonly id: AiProviderId;
  readonly spec: AiProviderSpec;
  readonly modelCatalogProvider: AiSdkModelCatalogProvider;
  readonly getRuntimeAdapter: (config: AiSdkProviderConfig) => AiRuntimeAdapter;
}
