import type { LLMOptions, LLMProviderOptions } from "@/types";
import {
  catalogProviderId,
  isAiProviderId,
  type AiProviderSpec,
} from "./catalog";
import { getLegacyProviderSpec } from "./legacyProviders";
import { getModelsDevProvider } from "./modelsDev";

/** Resolve the old fixed-provider shape without changing its ID or endpoint. */
export const normalizeAiConnection = (
  id: string,
  value: LLMProviderOptions,
): LLMProviderOptions => {
  const legacy = value.backendKind ? undefined : getLegacyProviderSpec(id);
  const api =
    legacy?.apiOptions?.find((option) => option.id === value.apiOptionId) ||
    legacy?.apiOptions?.find(
      (option) => option.id === legacy.defaultApiOptionId,
    );
  // Retire saved custom model overrides while retaining connection credentials.
  const { customModels: _customModels, ...connection } =
    value as LLMProviderOptions & { customModels?: unknown };
  return {
    ...connection,
    name: value.name ?? legacy?.label ?? id,
    catalogId:
      value.catalogId ??
      (legacy && !id.endsWith("-compatible") ? catalogProviderId(id) : ""),
    backendKind:
      value.backendKind ||
      api?.backendKind ||
      legacy?.backendKind ||
      "openai-compatible",
    apiUrl:
      value.apiUrl?.trim() ||
      api?.defaultBaseUrl ||
      legacy?.defaultBaseUrl ||
      (legacy?.id === "gemini"
        ? "https://generativelanguage.googleapis.com/v1beta"
        : ""),
    apiKey: value.apiKey?.trim() || "",
    enabled: value.enabled !== false,
    authMode:
      value.authMode ||
      (id === "xiaomi-mimo" && api?.backendKind === "anthropic-compatible"
        ? "bearer"
        : "api-key"),
  };
};

export const normalizeAiConnections = (value: LLMOptions): LLMOptions =>
  Object.fromEntries(
    Object.entries(value || {}).flatMap(([id, connection]) => {
      if (!isAiProviderId(id) || !connection || typeof connection !== "object")
        return [];
      // Empty placeholders from the old schema are not user-created connections.
      if (
        !connection.backendKind &&
        !connection.apiKey?.trim() &&
        !connection.apiUrl?.trim()
      )
        return [];
      return [[id, normalizeAiConnection(id, connection)]];
    }),
  );

export const createAiConnection = (
  spec?: AiProviderSpec,
): LLMProviderOptions => ({
  name: spec?.label || "",
  catalogId: spec?.id || "",
  backendKind: spec?.backendKind || "openai-compatible",
  apiUrl: spec?.defaultBaseUrl || "",
  apiKey: "",
  enabled: true,
  authMode: "api-key",
});

/** Catalog names are automatic; stored names remain the offline fallback. */
export const getAiConnectionLabel = (
  connections: LLMOptions,
  id: string,
  customFallback = id,
): string => {
  const saved = connections[id];
  if (!saved) return customFallback;
  const connection = normalizeAiConnection(id, saved);
  if (!connection.catalogId) return connection.name || customFallback;
  const source = catalogProviderId(connection.catalogId);
  const name = getModelsDevProvider(source)?.name || connection.name || source;
  const peers = Object.entries(connections).filter(
    ([peerId, value]) =>
      catalogProviderId(
        normalizeAiConnection(peerId, value).catalogId || "",
      ) === source,
  );
  return peers.length > 1
    ? `${name} (${peers.findIndex(([peerId]) => peerId === id) + 1})`
    : name;
};

type ConnectionAuthMode = NonNullable<LLMProviderOptions["authMode"]>;
/** `api-key` means the SDK's default authentication, including Bearer for OpenAI. */
export const getAiConnectionAuthModes = (
  connection: Pick<LLMProviderOptions, "backendKind">,
): ConnectionAuthMode[] =>
  connection.backendKind === "anthropic" ||
  connection.backendKind === "anthropic-compatible"
    ? ["api-key", "bearer", "none"]
    : ["api-key", "none"];

export const getAiConnectionAuthMode = (
  connection: Pick<LLMProviderOptions, "backendKind" | "authMode">,
): ConnectionAuthMode =>
  connection.authMode &&
  getAiConnectionAuthModes(connection).includes(connection.authMode)
    ? connection.authMode
    : "api-key";
