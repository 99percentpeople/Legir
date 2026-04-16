/**
 * AI SDK adapter contracts.
 *
 * Keep provider configuration, model specifiers, and resolved SDK model types
 * here. Higher-level chat/task payloads should stay in their own feature
 * folders.
 */
import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
import type { LanguageModel } from "ai";
import type { LLMModelOption } from "@/services/ai/types";
import type { AiProviderId } from "@/services/ai/sdk/providerCatalog";
import type { AppOptions, EditorState, LLMModelCapabilities } from "@/types";

export type AiSdkProviderId = AiProviderId;

export type AiSdkBackendKind =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "minimax-anthropic"
  | "minimax-openai"
  | "zhipu"
  | "openrouter"
  | "groq"
  | "xai"
  | "openai-compatible";

export interface AiSdkProviderConfig {
  providerId: AiSdkProviderId;
  label: string;
  backendKind: AiSdkBackendKind;
  apiOptionId?: string;
  apiKey: string;
  baseURL?: string;
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

export type AiSdkTaskModelKind = "translate" | "vision" | "chat" | "summarize";

export interface AiSdkModelCallOptions {
  providerOptions?: SharedV3ProviderOptions;
}

export interface AiSdkDiscoveredModel {
  id: string;
  label?: string;
  capabilities: LLMModelCapabilities;
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
