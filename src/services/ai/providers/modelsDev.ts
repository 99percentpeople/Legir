import {
  catalogProviderId,
  getCatalogProviderSpec,
  isAiProviderId,
  isTextGenerationModelId,
  type AiProviderSpec,
} from "./catalog";
export interface CatalogModel {
  id: string;
  name: string;
  modalities?: { input?: string[]; output?: string[] };
  limit?: { context?: number; output?: number };
  tool_call?: boolean;
  reasoning?: boolean;
  reasoning_options?: Array<{
    type: string;
    values?: string[];
    min?: number;
    max?: number;
  }>;
  release_date?: string;
  status?: string;
}
export interface CatalogProvider {
  id: string;
  name: string;
  npm: string;
  api?: string;
  models: Record<string, CatalogModel>;
}
export type ModelsDevCatalog = Record<string, CatalogProvider>;
const CACHE_KEY = "legir.models-dev.v1";
export const MODELS_DEV_TTL_MS = 24 * 60 * 60 * 1000;
const listeners = new Set<() => void>();
let catalog: ModelsDevCatalog = {};
let updatedAt = 0;
let lastAttemptAt = 0;
let revision = 0;
let initialized: Promise<void> | undefined;
let refreshing: Promise<void> | undefined;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
const positive = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : undefined;
const nonnegative = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : undefined;
/** Network, cache and snapshot use one parser. No executable catalog metadata is loaded. */
export const parseModelsDevCatalog = (value: unknown): ModelsDevCatalog => {
  if (!record(value)) throw new Error("Invalid models.dev catalog.");
  const result: ModelsDevCatalog = {};
  for (const [id, raw] of Object.entries(value)) {
    if (
      !isAiProviderId(id) ||
      !record(raw) ||
      typeof raw.name !== "string" ||
      typeof raw.npm !== "string" ||
      !record(raw.models)
    )
      continue;
    const provider: CatalogProvider = {
      id,
      name: raw.name,
      npm: raw.npm,
      api: typeof raw.api === "string" ? raw.api : undefined,
      models: {},
    };
    if (!getCatalogProviderSpec(provider)) continue;
    for (const [modelId, model] of Object.entries(raw.models)) {
      if (
        !modelId ||
        !isTextGenerationModelId(modelId) ||
        ["__proto__", "constructor", "prototype"].includes(modelId) ||
        !record(model)
      )
        continue;
      const input = record(model.modalities)
        ? strings(model.modalities.input)
        : undefined;
      const output = record(model.modalities)
        ? strings(model.modalities.output)
        : undefined;
      if (
        !input?.includes("text") ||
        !output?.includes("text") ||
        (record(model.limit) && model.limit.output === 0)
      )
        continue;
      if (
        model.family === "text-embedding" ||
        modelId.startsWith("text-embedding-") ||
        modelId.includes("realtime")
      )
        continue;
      provider.models[modelId] = {
        id: modelId,
        name: typeof model.name === "string" ? model.name : modelId,
        modalities: { input, output },
        limit: record(model.limit)
          ? {
              context: positive(model.limit.context),
              output: positive(model.limit.output),
            }
          : undefined,
        tool_call:
          typeof model.tool_call === "boolean" ? model.tool_call : undefined,
        reasoning:
          typeof model.reasoning === "boolean" ? model.reasoning : undefined,
        reasoning_options: Array.isArray(model.reasoning_options)
          ? model.reasoning_options.flatMap((option) =>
              record(option) && typeof option.type === "string"
                ? [
                    {
                      type: option.type,
                      values: strings(option.values),
                      min: nonnegative(option.min),
                      max: nonnegative(option.max),
                    },
                  ]
                : [],
            )
          : undefined,
        release_date:
          typeof model.release_date === "string"
            ? model.release_date
            : undefined,
        status: typeof model.status === "string" ? model.status : undefined,
      };
    }
    if (Object.keys(provider.models).length) result[id] = provider;
  }
  if (!Object.keys(result).length)
    throw new Error("No supported providers in models.dev catalog.");
  return result;
};
const publish = (next: ModelsDevCatalog) => {
  catalog = next;
  revision++;
  for (const listener of listeners) listener();
};
export const subscribeModelsDev = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getModelsDevRevision = () => revision;
export const getModelsDevProvider = (id: string): CatalogProvider | undefined =>
  catalog[catalogProviderId(id)];
export const getModelsDevModel = (
  id: string,
  modelId: string,
): CatalogModel | undefined => getModelsDevProvider(id)?.models[modelId];
export const getModelsDevProviders = (): AiProviderSpec[] =>
  Object.values(catalog)
    .flatMap((provider) => {
      const spec = getCatalogProviderSpec(provider);
      return spec ? [spec] : [];
    })
    .sort((a, b) => a.label.localeCompare(b.label));
export const initializeModelsDev = (): Promise<void> =>
  (initialized ??= (async () => {
    const bundled = await import("./models-dev.snapshot.json?raw");
    let next = parseModelsDevCatalog(JSON.parse(bundled.default));
    try {
      const cached: unknown = JSON.parse(
        localStorage.getItem(CACHE_KEY) || "null",
      );
      if (
        record(cached) &&
        typeof cached.updatedAt === "number" &&
        cached.updatedAt <= Date.now()
      ) {
        next = parseModelsDevCatalog(cached.catalog);
        updatedAt = cached.updatedAt;
      }
    } catch {
      /* Unavailable storage keeps the bundled snapshot. */
    }
    publish(next);
  })());
export const refreshModelsDev = async (
  options: { force?: boolean; fetch?: typeof fetch } = {},
) => {
  await initializeModelsDev();
  if (
    !options.force &&
    (Date.now() - updatedAt < MODELS_DEV_TTL_MS ||
      Date.now() - lastAttemptAt < 60_000)
  )
    return;
  return (refreshing ??= (async () => {
    lastAttemptAt = Date.now();
    const response = await (options.fetch ?? fetch)(
      "https://models.dev/api.json",
      { signal: AbortSignal.timeout(12_000), credentials: "omit" },
    );
    if (!response.ok) throw new Error(`models.dev: ${response.status}`);
    const next = parseModelsDevCatalog(await response.json());
    updatedAt = Date.now();
    publish(next);
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ updatedAt, catalog: next }),
      );
    } catch {
      /* Keep the in-memory catalog. */
    }
  })().finally(() => {
    refreshing = undefined;
  }));
};
