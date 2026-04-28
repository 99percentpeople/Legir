import { once } from "node:events";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "node:http";
import type { Plugin } from "vite";

export const DEV_API_PROXY_PATH = "/__legir_dev_proxy";

const REQUEST_HEADERS_TO_SKIP = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "origin",
  "proxy-authenticate",
  "proxy-authorization",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const RESPONSE_HEADERS_TO_SKIP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const readProxyRequestBody = async (request: IncomingMessage) => {
  if (request.method === "GET" || request.method === "HEAD") return undefined;

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
};

const getProxyTargetUrl = (requestUrl: string | undefined) => {
  const requestUrlObject = new URL(requestUrl || "", "http://localhost");
  const targetUrl = requestUrlObject.searchParams.get("url")?.trim();
  if (!targetUrl) {
    throw new Error("Missing proxy target URL.");
  }

  const parsedTargetUrl = new URL(targetUrl);
  if (
    parsedTargetUrl.protocol !== "http:" &&
    parsedTargetUrl.protocol !== "https:"
  ) {
    throw new Error("Proxy target URL must use http or https.");
  }

  return parsedTargetUrl;
};

const setProxyCorsHeaders = (response: ServerResponse) => {
  response.setHeader("access-control-allow-origin", "*");
};

const writeProxyErrorResponse = (
  response: ServerResponse,
  statusCode: number,
  error: unknown,
) => {
  if (response.destroyed) return;
  if (response.headersSent) {
    response.destroy(error instanceof Error ? error : undefined);
    return;
  }

  response.statusCode = statusCode;
  setProxyCorsHeaders(response);
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(
    JSON.stringify({
      error:
        error instanceof Error ? error.message : "Vite dev API proxy failed.",
    }),
  );
};

const buildProxyRequestHeaders = (headers: IncomingHttpHeaders) => {
  const output = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (REQUEST_HEADERS_TO_SKIP.has(key.toLowerCase())) continue;
    if (Array.isArray(value)) {
      value.forEach((item) => output.append(key, item));
      continue;
    }
    if (typeof value === "string") output.set(key, value);
  }

  output.set("accept-encoding", "identity");
  return output;
};

const copyProxyResponseHeaders = (
  response: ServerResponse,
  headers: Headers,
) => {
  headers.forEach((value, key) => {
    if (!value || RESPONSE_HEADERS_TO_SKIP.has(key.toLowerCase())) return;
    response.setHeader(key, value);
  });
  setProxyCorsHeaders(response);
};

const streamProxyResponseBody = async (
  upstreamResponse: Response,
  response: ServerResponse,
) => {
  if (!upstreamResponse.body) {
    response.end();
    return;
  }

  for await (const chunk of upstreamResponse.body) {
    if (!response.write(chunk)) {
      await once(response, "drain");
    }
  }
  response.end();
};

const forwardDevProxyRequest = async (options: {
  request: IncomingMessage;
  response: ServerResponse;
  targetUrl: URL;
  body: Buffer | undefined;
}) => {
  const abortController = new AbortController();
  options.response.once("close", () => {
    if (!options.response.writableEnded) abortController.abort();
  });

  const upstreamResponse = await fetch(options.targetUrl, {
    method: options.request.method,
    headers: buildProxyRequestHeaders(options.request.headers),
    body: options.body ? new Uint8Array(options.body) : undefined,
    signal: abortController.signal,
  });

  options.response.statusCode = upstreamResponse.status;
  options.response.statusMessage = upstreamResponse.statusText;
  copyProxyResponseHeaders(options.response, upstreamResponse.headers);
  await streamProxyResponseBody(upstreamResponse, options.response);
};

export const viteDevApiProxyPlugin = (): Plugin => ({
  name: "legir-dev-api-proxy",
  configureServer(server) {
    server.middlewares.use(DEV_API_PROXY_PATH, async (request, response) => {
      if (request.method === "OPTIONS") {
        response.statusCode = 204;
        response.setHeader("access-control-allow-origin", "*");
        response.setHeader(
          "access-control-allow-methods",
          "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        );
        response.setHeader("access-control-allow-headers", "*");
        response.end();
        return;
      }

      let targetUrl: URL | null = null;
      try {
        targetUrl = getProxyTargetUrl(request.url);
        await forwardDevProxyRequest({
          request,
          response,
          targetUrl,
          body: await readProxyRequestBody(request),
        });
      } catch (error) {
        writeProxyErrorResponse(response, targetUrl ? 502 : 400, error);
      }
    });
  },
});
