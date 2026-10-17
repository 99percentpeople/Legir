// Frozen pre-connection settings schema. Used only to migrate saved preferences.
type AiProviderId = string;

type AiProviderBackendKind =
  | "openai"
  | "anthropic"
  | "anthropic-compatible"
  | "google"
  | "deepseek"
  | "zhipu"
  | "openrouter"
  | "groq"
  | "xai"
  | "openai-compatible";

interface AiProviderApiSpec {
  id: string;
  label: string;
  labelKey?: string;
  backendKind: AiProviderBackendKind;
  defaultBaseUrl?: string;
}

interface AiProviderSpec {
  id: AiProviderId;
  label: string;
  labelKey?: string;
  backendKind: AiProviderBackendKind;
  defaultBaseUrl?: string;
  apiOptions?: readonly AiProviderApiSpec[];
  defaultApiOptionId?: string;
}

const LEGACY_PROVIDER_SPECS: readonly AiProviderSpec[] = [
  {
    id: "openai",
    label: "OpenAI",
    backendKind: "openai",
    defaultBaseUrl: "https://api.openai.com/v1",
  },
  {
    id: "openai-compatible",
    label: "OpenAI Compatible",
    backendKind: "openai-compatible",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    backendKind: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
  },
  {
    id: "anthropic-compatible",
    label: "Anthropic Compatible",
    backendKind: "anthropic-compatible",
  },
  {
    id: "xiaomi-mimo",
    label: "Xiaomi MiMo",
    backendKind: "openai-compatible",
    defaultBaseUrl: "https://api.xiaomimimo.com/v1",
    apiOptions: [
      {
        id: "openai",
        label: "OpenAI Compatible",
        backendKind: "openai-compatible",
        defaultBaseUrl: "https://api.xiaomimimo.com/v1",
      },
      {
        id: "anthropic",
        label: "Anthropic Compatible",
        backendKind: "anthropic-compatible",
        defaultBaseUrl: "https://api.xiaomimimo.com/anthropic/v1",
      },
    ],
    defaultApiOptionId: "openai",
  },
  {
    id: "gemini",
    label: "Gemini",
    backendKind: "google",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    backendKind: "openrouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    backendKind: "deepseek",
    defaultBaseUrl: "https://api.deepseek.com/v1",
  },
  {
    id: "minimax",
    label: "MiniMax",
    backendKind: "anthropic-compatible",
    defaultBaseUrl: "https://api.minimax.io/anthropic/v1",
    apiOptions: [
      {
        id: "anthropic",
        label: "Anthropic Compatible",
        backendKind: "anthropic-compatible",
        defaultBaseUrl: "https://api.minimax.io/anthropic/v1",
      },
      {
        id: "openai",
        label: "OpenAI Compatible",
        backendKind: "openai-compatible",
        defaultBaseUrl: "https://api.minimax.io/v1",
      },
    ],
    defaultApiOptionId: "anthropic",
  },
  {
    id: "zhipu",
    label: "Zhipu",
    backendKind: "zhipu",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
  },
  {
    id: "groq",
    label: "Groq",
    backendKind: "groq",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
  },
  {
    id: "xai",
    label: "xAI",
    backendKind: "xai",
    defaultBaseUrl: "https://api.x.ai/v1",
  },
] as const;

export const getLegacyProviderSpec = (id: string) =>
  LEGACY_PROVIDER_SPECS.find((spec) => spec.id === id);
