export const AI_PROVIDER_IDS = [
  "openai",
  "gemini",
  "openrouter",
  "deepseek",
  "groq",
  "xai",
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export type AiProviderBackendKind = "openai" | "google" | "openai-compatible";

export interface AiProviderSpec {
  id: AiProviderId;
  label: string;
  labelKey?: string;
  backendKind: AiProviderBackendKind;
  defaultBaseUrl?: string;
  allowCustomBaseUrl: boolean;
  fallbackModelId?: string;
  unavailableMessageKey?: string;
  modelListMode: "openai" | "google";
}

export const AI_PROVIDER_SPECS: readonly AiProviderSpec[] = [
  {
    id: "openai",
    label: "OpenAI",
    backendKind: "openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    allowCustomBaseUrl: true,
    fallbackModelId: "gpt-4.1-mini",
    unavailableMessageKey: "properties.form_detection.api_key_missing",
    modelListMode: "openai",
  },
  {
    id: "gemini",
    label: "Gemini",
    backendKind: "google",
    allowCustomBaseUrl: false,
    fallbackModelId: "gemini-2.5-flash",
    unavailableMessageKey: "properties.form_detection.api_key_missing",
    modelListMode: "google",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    backendKind: "openai-compatible",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    allowCustomBaseUrl: true,
    fallbackModelId: "",
    unavailableMessageKey: "properties.form_detection.api_key_missing",
    modelListMode: "openai",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    backendKind: "openai-compatible",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    allowCustomBaseUrl: true,
    fallbackModelId: "deepseek-chat",
    unavailableMessageKey: "properties.form_detection.api_key_missing",
    modelListMode: "openai",
  },
  {
    id: "groq",
    label: "Groq",
    backendKind: "openai-compatible",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    allowCustomBaseUrl: true,
    fallbackModelId: "",
    unavailableMessageKey: "properties.form_detection.api_key_missing",
    modelListMode: "openai",
  },
  {
    id: "xai",
    label: "xAI",
    backendKind: "openai-compatible",
    defaultBaseUrl: "https://api.x.ai/v1",
    allowCustomBaseUrl: true,
    fallbackModelId: "",
    unavailableMessageKey: "properties.form_detection.api_key_missing",
    modelListMode: "openai",
  },
] as const;

export const AI_PROVIDER_LABELS = Object.fromEntries(
  AI_PROVIDER_SPECS.map((spec) => [spec.id, spec.label]),
) as Record<AiProviderId, string>;

export const isAiProviderId = (value: string): value is AiProviderId =>
  AI_PROVIDER_IDS.includes(value as AiProviderId);

export const getAiProviderSpec = (providerId: AiProviderId) =>
  AI_PROVIDER_SPECS.find((spec) => spec.id === providerId)!;
