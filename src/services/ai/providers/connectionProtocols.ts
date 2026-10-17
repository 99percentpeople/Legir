import type { LLMProviderOptions } from "@/types";
import {
  AI_CONNECTION_PROTOCOLS,
  getCatalogProviderSpec,
  type AiProviderBackendKind,
} from "./catalog";
import { getModelsDevProvider } from "./modelsDev";
import { getAiConnectionAuthMode } from "./connections";

type ProtocolId = (typeof AI_CONNECTION_PROTOCOLS)[number]["id"];
const BACKEND_PROTOCOLS: Record<AiProviderBackendKind, ProtocolId> = {
  openai: "openai",
  "openai-compatible": "openai-compatible",
  anthropic: "anthropic-compatible",
  "anthropic-compatible": "anthropic-compatible",
  google: "google",
  openrouter: "openai-compatible",
  groq: "openai-compatible",
  xai: "openai-compatible",
  deepseek: "openai-compatible",
  zhipu: "openai-compatible",
};
export interface AiConnectionProtocolOption {
  id: AiProviderBackendKind;
  label: string;
  available: boolean;
  defaultBaseUrl?: string;
}
const protocolOption = (
  id: AiProviderBackendKind,
  available: boolean,
  defaultBaseUrl?: string,
): AiConnectionProtocolOption => ({
  id,
  label:
    AI_CONNECTION_PROTOCOLS.find(
      (protocol) => protocol.id === BACKEND_PROTOCOLS[id],
    )?.label || id,
  available,
  defaultBaseUrl,
});

/** models.dev declares a default SDK, not an exhaustive protocol support matrix. */
export const getAiConnectionProtocols = (
  connection: LLMProviderOptions,
): AiConnectionProtocolOption[] => {
  const current = connection.backendKind || "openai-compatible";
  if (!connection.catalogId) {
    return AI_CONNECTION_PROTOCOLS.map((protocol) =>
      protocolOption(
        protocol.id === BACKEND_PROTOCOLS[current] ? current : protocol.id,
        true,
      ),
    );
  }
  const provider = getModelsDevProvider(connection.catalogId);
  const spec = provider ? getCatalogProviderSpec(provider) : null;
  // Keep native adapters (e.g. Groq) when their wire format matches the catalog.
  if (
    spec &&
    BACKEND_PROTOCOLS[current] === BACKEND_PROTOCOLS[spec.backendKind]
  ) {
    return [protocolOption(current, true, spec.defaultBaseUrl)];
  }
  return [
    ...(spec
      ? [protocolOption(spec.backendKind, true, spec.defaultBaseUrl)]
      : []),
    // Retain an older setting without offering it as a newly supported choice.
    protocolOption(current, false),
  ];
};

/** Only an explicit format selection changes the endpoint; catalog refresh never does. */
export const getAiConnectionProtocolPatch = (
  connection: LLMProviderOptions,
  value: string,
): Partial<LLMProviderOptions> | null => {
  const protocol = getAiConnectionProtocols(connection).find(
    (option) => option.id === value && option.available,
  );
  if (!protocol || protocol.id === connection.backendKind) return null;
  const authMode = getAiConnectionAuthMode({
    ...connection,
    backendKind: protocol.id,
  });
  return {
    backendKind: protocol.id,
    ...(protocol.defaultBaseUrl ? { apiUrl: protocol.defaultBaseUrl } : {}),
    ...(connection.authMode && authMode !== connection.authMode
      ? { authMode }
      : {}),
  };
};
