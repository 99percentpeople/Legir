/** Provider identities are catalog data; only supported wire protocols are code. */
export type AiProviderId = string;
export type AiProviderBackendKind =
  | "openai"
  | "openai-compatible"
  | "anthropic"
  | "anthropic-compatible"
  | "google"
  | "openrouter"
  | "groq"
  | "xai"
  | "deepseek"
  | "zhipu";
export const AI_CONNECTION_PROTOCOLS = [
  { id: "openai-compatible", label: "OpenAI Chat Completions" },
  { id: "openai", label: "OpenAI Responses" },
  { id: "anthropic-compatible", label: "Anthropic Messages" },
  { id: "google", label: "Google Generative AI" },
] as const;
export const isAiProviderId = (value: string): value is AiProviderId =>
  /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) &&
  !["__proto__", "constructor", "prototype"].includes(value);
/** Exclude known non-generation API families from generic /models responses. */
export const isTextGenerationModelId = (id: string) =>
  !/(?:^|[-_/])(?:embeddings?|moderation|tts|whisper|transcription|speech|image|realtime)(?:[-_/]|$)/i.test(
    id,
  );
export interface AiProviderSpec {
  id: string;
  label: string;
  backendKind: AiProviderBackendKind;
  defaultBaseUrl: string;
}
export const catalogProviderId = (id: string): string =>
  (
    ({ gemini: "google", "xiaomi-mimo": "xiaomi", zhipu: "zhipuai" }) as Record<
      string,
      string
    >
  )[id] || id;
/** Separate from connection IDs and SDK option namespaces. */
export const runtimeProviderId = (id: string): string =>
  (
    ({ google: "gemini", xiaomi: "xiaomi-mimo", zhipuai: "zhipu" }) as Record<
      string,
      string
    >
  )[id] || id;
const SDK_PROTOCOLS: Record<
  string,
  { kind: AiProviderBackendKind; id?: string; url?: string }
> = {
  "@ai-sdk/openai-compatible": { kind: "openai-compatible" },
  "@ai-sdk/openai": {
    kind: "openai",
    id: "openai",
    url: "https://api.openai.com/v1",
  },
  "@ai-sdk/anthropic": {
    kind: "anthropic",
    id: "anthropic",
    url: "https://api.anthropic.com/v1",
  },
  "@ai-sdk/google": {
    kind: "google",
    id: "google",
    url: "https://generativelanguage.googleapis.com/v1beta",
  },
  "@openrouter/ai-sdk-provider": {
    kind: "openrouter",
    id: "openrouter",
    url: "https://openrouter.ai/api/v1",
  },
  "@ai-sdk/groq": {
    kind: "groq",
    id: "groq",
    url: "https://api.groq.com/openai/v1",
  },
  "@ai-sdk/xai": { kind: "xai", id: "xai", url: "https://api.x.ai/v1" },
};
export const getCatalogProviderSpec = (provider: {
  id: string;
  name: string;
  npm: string;
  api?: string;
}): AiProviderSpec | null => {
  const protocol = SDK_PROTOCOLS[provider.npm];
  if (!protocol) return null;
  const defaultBaseUrl =
    provider.api || (protocol.id === provider.id ? protocol.url : "");
  if (!defaultBaseUrl) return null;
  try {
    const url = new URL(defaultBaseUrl);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
  } catch {
    return null;
  }
  return {
    id: provider.id,
    label: provider.name,
    backendKind: protocol.kind,
    defaultBaseUrl,
  };
};
