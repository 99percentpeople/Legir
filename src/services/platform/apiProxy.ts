import type { AppOptions } from "@/types";
import { isDesktopApp } from "@/services/platform/runtime";

const API_PROXY_URL_PLACEHOLDER = "{url}";
const TAURI_API_PROXY_RESPONSE_START_EVENT = "app://api-proxy-response-start";
const TAURI_API_PROXY_RESPONSE_CHUNK_EVENT = "app://api-proxy-response-chunk";
const TAURI_API_PROXY_RESPONSE_END_EVENT = "app://api-proxy-response-end";
const TAURI_API_PROXY_RESPONSE_ERROR_EVENT = "app://api-proxy-response-error";

type TauriApiProxyResponseStartPayload = {
  requestId: string;
  status: number;
  statusText?: string;
  headers?: Array<[string, string]>;
};

type TauriApiProxyResponseChunkPayload = {
  requestId: string;
  chunkBase64: string;
};

type TauriApiProxyResponseEndPayload = {
  requestId: string;
};

type TauriApiProxyResponseErrorPayload = {
  requestId: string;
  message: string;
};

const normalizeOptionalText = (value: string | undefined) =>
  value?.trim() || "";

const canRequestHaveBody = (method: string) => {
  const normalizedMethod = method.trim().toUpperCase();
  return normalizedMethod !== "GET" && normalizedMethod !== "HEAD";
};

type RequestInitWithDuplex = RequestInit & {
  duplex?: "half";
};

const isReadableStreamBody = (
  body: RequestInit["body"] | ReadableStream<unknown> | null | undefined,
): body is ReadableStream<unknown> =>
  typeof ReadableStream !== "undefined" && body instanceof ReadableStream;

const resolveRequestBody = (input: RequestInfo | URL, init?: RequestInit) => {
  if (init && "body" in init) {
    return init.body;
  }

  return input instanceof Request ? input.body : undefined;
};

const withRequestDuplexIfNeeded = (
  input: RequestInfo | URL,
  init?: RequestInit,
): RequestInitWithDuplex | undefined => {
  const body = resolveRequestBody(input, init);
  if (!isReadableStreamBody(body)) {
    return init;
  }

  return {
    ...(init || {}),
    duplex: "half",
  };
};

const createAbortError = () => {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
};

const buildApiProxyRequestId = () => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `api_proxy_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const headersToObject = (headers: Headers) => {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key] = value;
  });
  return output;
};

const readRequestBodyAsBase64 = async (request: Request) => {
  if (!canRequestHaveBody(request.method)) return undefined;

  const bodyBytes = new Uint8Array(await request.arrayBuffer());
  if (bodyBytes.byteLength === 0) return undefined;
  return bytesToBase64(bodyBytes);
};

const buildFetchInitFromRequest = (request: Request): RequestInitWithDuplex => {
  const init: RequestInitWithDuplex = {
    method: request.method,
    headers: new Headers(request.headers),
    signal: request.signal,
    cache: request.cache,
    credentials: request.credentials,
    integrity: request.integrity,
    keepalive: request.keepalive,
    mode: request.mode,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
  };

  if (canRequestHaveBody(request.method)) {
    init.body = request.body;
    if (isReadableStreamBody(request.body)) {
      init.duplex = "half";
    }
  }

  return init;
};

type ApiProxyRuntimeConfig = {
  tauriForwardEnabled: boolean;
  proxyUrlEnabled: boolean;
  proxyUrl: string;
};

export const getApiProxyRuntimeConfig = (
  options: AppOptions,
): ApiProxyRuntimeConfig => {
  const proxyUrl = normalizeOptionalText(options.apiProxy.proxyUrl);
  const proxyUrlEnabled =
    options.apiProxy.proxyUrlEnabled === true && !!proxyUrl;

  return {
    tauriForwardEnabled:
      options.apiProxy.tauriForwardEnabled === true && isDesktopApp(),
    proxyUrlEnabled,
    proxyUrl,
  };
};

export const buildApiProxyTargetUrl = (proxyUrl: string, targetUrl: string) => {
  const normalizedProxyUrl = normalizeOptionalText(proxyUrl);
  if (!normalizedProxyUrl) return targetUrl;

  if (normalizedProxyUrl.includes(API_PROXY_URL_PLACEHOLDER)) {
    return normalizedProxyUrl.replaceAll(
      API_PROXY_URL_PLACEHOLDER,
      encodeURIComponent(targetUrl),
    );
  }

  const baseUrl =
    typeof window !== "undefined"
      ? new URL(normalizedProxyUrl, window.location.href)
      : new URL(normalizedProxyUrl);
  baseUrl.searchParams.set("url", targetUrl);
  return baseUrl.toString();
};

const fetchViaTauriProxy = async (request: Request) => {
  const [{ invoke }, { listen }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
  ]);

  const requestId = buildApiProxyRequestId();
  const requestHeaders = headersToObject(request.headers);
  const bodyBase64 = await readRequestBodyAsBase64(request);

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let didStart = false;
  let didFinish = false;
  let resolveResponse: ((response: Response) => void) | null = null;
  let rejectResponse: ((error: Error) => void) | null = null;

  const responsePromise = new Promise<Response>((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });

  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
    },
    cancel() {
      void invoke("cancel_api_proxy_request", { requestId }).catch(() => {});
    },
  });

  const cleanupCallbacks: Array<() => void> = [];
  const cleanup = () => {
    if (didFinish) return;
    didFinish = true;
    for (const callback of cleanupCallbacks.splice(0)) {
      try {
        callback();
      } catch {
        // ignore
      }
    }
  };

  const fail = (error: Error) => {
    cleanup();

    if (didStart) {
      controller?.error(error);
      return;
    }

    rejectResponse?.(error);
  };

  const [unlistenStart, unlistenChunk, unlistenEnd, unlistenError] =
    await Promise.all([
      listen<TauriApiProxyResponseStartPayload>(
        TAURI_API_PROXY_RESPONSE_START_EVENT,
        (event) => {
          if (event.payload.requestId !== requestId || didFinish) return;

          didStart = true;
          const headers = new Headers();
          for (const [key, value] of event.payload.headers || []) {
            headers.append(key, value);
          }

          resolveResponse?.(
            new Response(stream, {
              status: event.payload.status,
              statusText: event.payload.statusText || "",
              headers,
            }),
          );
        },
      ),
      listen<TauriApiProxyResponseChunkPayload>(
        TAURI_API_PROXY_RESPONSE_CHUNK_EVENT,
        (event) => {
          if (event.payload.requestId !== requestId || didFinish) return;
          controller?.enqueue(base64ToBytes(event.payload.chunkBase64));
        },
      ),
      listen<TauriApiProxyResponseEndPayload>(
        TAURI_API_PROXY_RESPONSE_END_EVENT,
        (event) => {
          if (event.payload.requestId !== requestId || didFinish) return;
          cleanup();
          try {
            controller?.close();
          } catch {
            // ignore
          }
        },
      ),
      listen<TauriApiProxyResponseErrorPayload>(
        TAURI_API_PROXY_RESPONSE_ERROR_EVENT,
        (event) => {
          if (event.payload.requestId !== requestId || didFinish) return;
          fail(new Error(event.payload.message || "Tauri API proxy failed."));
        },
      ),
    ]);

  cleanupCallbacks.push(
    unlistenStart,
    unlistenChunk,
    unlistenEnd,
    unlistenError,
  );

  const abortSignal = request.signal;
  const handleAbort = () => {
    const abortError = createAbortError();
    fail(abortError);
    void invoke("cancel_api_proxy_request", { requestId }).catch(() => {});
  };

  if (abortSignal) {
    if (abortSignal.aborted) {
      handleAbort();
      return await responsePromise;
    }

    abortSignal.addEventListener("abort", handleAbort, { once: true });
    cleanupCallbacks.push(() =>
      abortSignal.removeEventListener("abort", handleAbort),
    );
  }

  try {
    await invoke("start_api_proxy_request", {
      requestId,
      url: request.url,
      method: request.method,
      headers: requestHeaders,
      bodyBase64,
    });
  } catch (error) {
    fail(
      error instanceof Error
        ? error
        : new Error(String(error || "Tauri API proxy failed.")),
    );
  }

  return await responsePromise;
};

export const fetchWithApiProxy = async (
  appOptions: AppOptions,
  input: RequestInfo | URL,
  init?: RequestInit,
) => {
  const runtimeConfig = getApiProxyRuntimeConfig(appOptions);

  if (!runtimeConfig.tauriForwardEnabled && !runtimeConfig.proxyUrlEnabled) {
    return await fetch(input, init);
  }

  const originalRequest = new Request(
    input,
    withRequestDuplexIfNeeded(input, init),
  );
  const effectiveUrl = runtimeConfig.proxyUrlEnabled
    ? buildApiProxyTargetUrl(runtimeConfig.proxyUrl, originalRequest.url)
    : originalRequest.url;

  const proxiedRequest = new Request(
    effectiveUrl,
    buildFetchInitFromRequest(originalRequest),
  );

  if (runtimeConfig.tauriForwardEnabled) {
    return await fetchViaTauriProxy(proxiedRequest);
  }

  return await fetch(proxiedRequest);
};

export const createApiProxyFetch = (appOptions: AppOptions) => {
  return async (input: RequestInfo | URL, init?: RequestInit) =>
    await fetchWithApiProxy(appOptions, input, init);
};
