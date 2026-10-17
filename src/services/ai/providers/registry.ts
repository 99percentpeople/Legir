import type { ProviderV3 } from "@ai-sdk/provider";
import {
  createAnthropicCompatibleAdapter,
  createOpenAiCompatibleAdapter,
  deepseekAdapter,
  geminiAdapter,
  groqAdapter,
  mimoAdapter,
  openAiAdapter,
  openRouterAdapter,
  xaiAdapter,
  zhipuAdapter,
} from "./runtimeAdapters";
import { runtimeProviderId } from "./catalog";
import type { AiRuntimeAdapter } from "./runtimeAdapters";
import type { AiSdkProviderConfig } from "./types";

/** Resolve protocol support independently of the number of configured connections. */
export const getAiRuntimeAdapter = (
  config: AiSdkProviderConfig,
): AiRuntimeAdapter => {
  const source =
    config.runtimeProviderId ||
    runtimeProviderId(config.catalogId || config.providerId);
  let adapter: AiRuntimeAdapter;
  switch (config.backendKind) {
    case "openai":
      adapter = openAiAdapter;
      break;
    case "anthropic":
    case "anthropic-compatible":
      adapter = createAnthropicCompatibleAdapter(source, {
        authMode: config.authMode === "bearer" ? "bearer" : "api-key",
      });
      break;
    case "google":
      adapter = geminiAdapter;
      break;
    case "openrouter":
      adapter = openRouterAdapter;
      break;
    case "groq":
      adapter = groqAdapter;
      break;
    case "xai":
      adapter = xaiAdapter;
      break;
    case "deepseek":
      adapter = deepseekAdapter;
      break;
    case "zhipu":
      adapter = zhipuAdapter;
      break;
    default:
      adapter =
        source === "deepseek"
          ? deepseekAdapter
          : source === "xiaomi-mimo"
            ? mimoAdapter
            : source === "zhipu"
              ? zhipuAdapter
              : createOpenAiCompatibleAdapter(source);
  }
  // SDK option namespaces belong to a protocol/provider, never to a user's connection UUID.
  const requestForAdapter = <T extends { providerId: string }>(
    request: T,
  ): T => ({
    ...request,
    providerId: source,
    catalogId: config.catalogId ?? source,
  });
  return {
    ...adapter,
    providerId: config.providerId,
    createSdkProvider: (request) => {
      const send = request.fetch || fetch;
      return adapter.createSdkProvider({
        ...request,
        providerId: source,
        fetch:
          config.authMode === "none"
            ? (input, init) => {
                const headers = new Headers(
                  init?.headers ||
                    (input instanceof Request ? input.headers : undefined),
                );
                for (const name of [
                  "authorization",
                  "x-api-key",
                  "x-goog-api-key",
                ])
                  headers.delete(name);
                return send(input, { ...init, headers });
              }
            : request.fetch,
      });
    },
    getReasoningCapability: (request) =>
      adapter.getReasoningCapability(requestForAdapter(request)),
    resolveReasoning: (request) =>
      adapter.resolveReasoning(requestForAdapter(request)),
    prepareMessages: adapter.prepareMessages
      ? (messages, request) =>
          adapter.prepareMessages!(messages, requestForAdapter(request))
      : undefined,
    validateMessages: adapter.validateMessages
      ? (messages, request) =>
          adapter.validateMessages!(messages, requestForAdapter(request))
      : undefined,
  };
};
export const createAiSdkProvider = async (
  config: AiSdkProviderConfig,
): Promise<ProviderV3> =>
  await getAiRuntimeAdapter(config).createSdkProvider(config);
