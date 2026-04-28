export const AI_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "deepseek",
  "minimax",
  "zhipu",
  "groq",
  "xai",
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export type AiProviderBackendKind =
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

export interface AiProviderApiSpec {
  id: string;
  label: string;
  labelKey?: string;
  backendKind: AiProviderBackendKind;
  defaultBaseUrl?: string;
}

export interface AiProviderSpec {
  id: AiProviderId;
  label: string;
  labelKey?: string;
  backendKind: AiProviderBackendKind;
  defaultBaseUrl?: string;
  apiOptions?: readonly AiProviderApiSpec[];
  defaultApiOptionId?: string;
  allowCustomBaseUrl: boolean;
  fallbackModelId?: string;
  unavailableMessageKey?: string;
}

export const AI_PROVIDER_SPECS: readonly AiProviderSpec[] = [
  {
    id: "openai",
    label: "OpenAI",
    backendKind: "openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    allowCustomBaseUrl: true,
    fallbackModelId: "gpt-5.4-mini",
    unavailableMessageKey: "properties.form_detection.api_key_missing",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    backendKind: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    allowCustomBaseUrl: true,
    fallbackModelId: "claude-sonnet-4-6",
    unavailableMessageKey: "properties.form_detection.api_key_missing",
  },
  {
    id: "gemini",
    label: "Gemini",
    backendKind: "google",
    allowCustomBaseUrl: false,
    fallbackModelId: "gemini-2.5-flash",
    unavailableMessageKey: "properties.form_detection.api_key_missing",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    backendKind: "openrouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    allowCustomBaseUrl: true,
    unavailableMessageKey: "properties.form_detection.api_key_missing",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    backendKind: "deepseek",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    allowCustomBaseUrl: true,
    fallbackModelId: "deepseek-chat",
    unavailableMessageKey: "properties.form_detection.api_key_missing",
  },
  {
    id: "minimax",
    label: "MiniMax",
    backendKind: "minimax-anthropic",
    defaultBaseUrl: "https://api.minimax.io/anthropic/v1",
    apiOptions: [
      {
        id: "anthropic",
        label: "Anthropic Compatible",
        backendKind: "minimax-anthropic",
        defaultBaseUrl: "https://api.minimax.io/anthropic/v1",
      },
      {
        id: "openai",
        label: "OpenAI Compatible",
        backendKind: "minimax-openai",
        defaultBaseUrl: "https://api.minimax.io/v1",
      },
    ],
    defaultApiOptionId: "anthropic",
    allowCustomBaseUrl: true,
    fallbackModelId: "MiniMax-M2.7",
    unavailableMessageKey: "properties.form_detection.api_key_missing",
  },
  {
    id: "zhipu",
    label: "Zhipu",
    backendKind: "zhipu",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    allowCustomBaseUrl: true,
    fallbackModelId: "glm-4.7",
    unavailableMessageKey: "properties.form_detection.api_key_missing",
  },
  {
    id: "groq",
    label: "Groq",
    backendKind: "groq",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    allowCustomBaseUrl: true,
    unavailableMessageKey: "properties.form_detection.api_key_missing",
  },
  {
    id: "xai",
    label: "xAI",
    backendKind: "xai",
    defaultBaseUrl: "https://api.x.ai/v1",
    allowCustomBaseUrl: true,
    unavailableMessageKey: "properties.form_detection.api_key_missing",
  },
] as const;

export const AI_PROVIDER_LABELS = Object.fromEntries(
  AI_PROVIDER_SPECS.map((spec) => [spec.id, spec.label]),
) as Record<AiProviderId, string>;

export const compareAiProviderIdsByLabel = (
  left: AiProviderId,
  right: AiProviderId,
) => AI_PROVIDER_LABELS[left].localeCompare(AI_PROVIDER_LABELS[right], "en");

export const AI_PROVIDER_IDS_SORTED_BY_LABEL = [...AI_PROVIDER_IDS].sort(
  compareAiProviderIdsByLabel,
);

export const AI_PROVIDER_SPECS_SORTED_BY_LABEL = [...AI_PROVIDER_SPECS].sort(
  (left, right) => compareAiProviderIdsByLabel(left.id, right.id),
);

export const isAiProviderId = (value: string): value is AiProviderId =>
  AI_PROVIDER_IDS.includes(value as AiProviderId);

export const getAiProviderSpec = (providerId: AiProviderId) =>
  AI_PROVIDER_SPECS.find((spec) => spec.id === providerId)!;

export const getAiProviderApiOptions = (providerId: AiProviderId) =>
  getAiProviderSpec(providerId).apiOptions || [];

export const getAiProviderDefaultApiOptionId = (providerId: AiProviderId) => {
  const spec = getAiProviderSpec(providerId);
  if (!spec.apiOptions || spec.apiOptions.length === 0) return "";
  return spec.defaultApiOptionId || spec.apiOptions[0]!.id;
};

export const getAiProviderSelectedApiOption = (
  providerId: AiProviderId,
  apiOptionId?: string,
) => {
  const spec = getAiProviderSpec(providerId);
  if (!spec.apiOptions || spec.apiOptions.length === 0) {
    return null;
  }

  const normalizedId = (apiOptionId || "").trim();
  return (
    spec.apiOptions.find((option) => option.id === normalizedId) ||
    spec.apiOptions.find(
      (option) => option.id === getAiProviderDefaultApiOptionId(providerId),
    ) ||
    spec.apiOptions[0] ||
    null
  );
};
