/**
 * AI SDK adapter contracts.
 *
 * Keep provider configuration, model specifiers, and resolved SDK model types
 * here. Higher-level chat/task payloads should stay in their own feature
 * folders.
 */
import type { LanguageModel } from "ai";
import type { LLMModelOption } from "@/services/ai/types";
import type { AiProviderId } from "@/services/ai/sdk/providerCatalog";
import type { AppOptions, EditorState, LLMModelCapabilities } from "@/types";

export type AiSdkProviderId = AiProviderId;

export type AiSdkBackendKind =
  | "openai"
  | "google"
  | "deepseek"
  | "openrouter"
  | "openai-compatible";

export interface AiSdkProviderConfig {
  providerId: AiSdkProviderId;
  label: string;
  backendKind: AiSdkBackendKind;
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
}

export type AiSdkTaskModelKind = "translate" | "vision" | "chat" | "summarize";

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

export interface AiSdkModelCatalogProvider {
  readonly providerId: AiSdkProviderId;
  fetchModels: (
    options: AiSdkModelCatalogProviderRequest,
  ) => Promise<LLMModelOption[]>;
  getModelsForTask: (
    options: AiSdkModelCatalogProviderTaskRequest,
  ) => LLMModelOption[];
  checkConfig: (
    options: AiSdkModelCatalogProviderRequest,
  ) => Promise<void> | void;
}
