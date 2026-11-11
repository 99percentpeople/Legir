import { getRuntimeProtocol, runtimeProviderId } from "./catalog";
import { runtimeProtocols } from "./runtimeAdapters/protocols";
import { createCatalogReasoningAdapter } from "./runtimeAdapters/catalogReasoning";
import type { AiRuntimeAdapter } from "./runtimeAdapters/types";
import type { AiSdkProviderConfig } from "./types";

/** Resolve protocol support independently of the number of configured connections. */
export const getAiRuntimeAdapter = (
  config: AiSdkProviderConfig,
): AiRuntimeAdapter => {
  const source =
    config.runtimeProviderId ||
    runtimeProviderId(config.catalogId || config.providerId);
  const protocol = getRuntimeProtocol(config.backendKind, source);
  const adapter = runtimeProtocols[protocol];
  const reasoning = createCatalogReasoningAdapter(protocol);
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
        authMode: config.authMode,
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
      reasoning.getReasoningCapability(requestForAdapter(request)),
    resolveReasoning: (request) =>
      reasoning.resolveReasoning(requestForAdapter(request)),
    validateMessages: adapter.validateMessages
      ? (messages, request) =>
          adapter.validateMessages!(messages, requestForAdapter(request))
      : undefined,
  };
};
