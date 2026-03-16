/**
 * AI SDK adapter contracts.
 *
 * Keep provider configuration, model specifiers, and resolved SDK model types
 * here. Higher-level chat/task payloads should stay in their own feature
 * folders.
 */
import type { LanguageModel } from "ai";
import type { AiProviderId } from "@/services/ai/sdk/providerCatalog";

export type AiSdkProviderId = AiProviderId;

export type AiSdkBackendKind = "openai" | "google" | "openai-compatible";

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
