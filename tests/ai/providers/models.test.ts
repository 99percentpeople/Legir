import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { DEFAULT_EDITOR_UI_STATE } from "@/constants";
import {
  createAiConnection,
  normalizeAiConnections,
} from "@/services/ai/providers/connections";
import { getConfiguredAiSdkProvider } from "@/services/ai/providers/settings";
import { getAiRuntimeAdapter } from "@/services/ai/providers/registry";
import {
  initializeModelsDev,
  getModelsDevProvider,
  getModelsDevProviders,
  parseModelsDevCatalog,
  refreshModelsDev,
} from "@/services/ai/providers/modelsDev";
import {
  getAiSdkModelGroups,
  getAiSdkProviderModelOptions,
} from "@/services/ai/providers/modelSelection";
import {
  parseAiSdkModelSpecifier,
  resolveAiSdkModelSpecifierForTask,
} from "@/services/ai/providers/modelResolver";
import { getAiSdkModelCatalogProvider } from "@/services/ai/providers/modelCatalogRegistry";
import { mergeEditorOptions } from "@/store/helpers";
import type { AppOptions } from "@/types";

beforeAll(() => initializeModelsDev());
afterEach(() => vi.unstubAllGlobals());
const options = (llm: AppOptions["llm"]): AppOptions => ({
  ...DEFAULT_EDITOR_UI_STATE.options,
  llm,
});
const connection = (catalogId = "openai") => ({
  ...createAiConnection({
    id: catalogId,
    label: "Work",
    backendKind: "openai",
    defaultBaseUrl: "https://work.example/v1",
  }),
  apiKey: "work-key",
});
const externalCatalog = {
  "new-service": {
    name: "New service",
    npm: "@ai-sdk/openai-compatible",
    api: "https://new.example/v1",
    models: {
      "new-model": {
        name: "New Model",
        modalities: { input: ["text", "image"], output: ["text"] },
        tool_call: true,
        reasoning: false,
        limit: { context: 64000 },
      },
    },
  },
};

describe("dynamic AI connections", () => {
  test("migrates saved providers without changing their IDs, credentials, API formats or selections", () => {
    const legacy = options({
      openai: {
        enabled: true,
        apiKey: " old-key ",
        apiUrl: "https://old.example/v1",
      },
      "xiaomi-mimo": {
        enabled: false,
        apiKey: "mimo-key",
        apiOptionId: "anthropic",
      },
      minimax: {
        enabled: true,
        apiKey: "mini-key",
        apiOptionId: "openai",
      },
      gemini: { enabled: true, apiKey: "" },
    });
    legacy.aiChat = { ...legacy.aiChat, visualModelKey: "openai:deployment" };
    const migrated = mergeEditorOptions(legacy);
    expect(migrated.llm.openai).toMatchObject({
      apiKey: "old-key",
      apiUrl: "https://old.example/v1",
      catalogId: "openai",
      backendKind: "openai",
    });
    expect(migrated.llm["xiaomi-mimo"]).toMatchObject({
      enabled: false,
      catalogId: "xiaomi",
      backendKind: "anthropic-compatible",
      authMode: "bearer",
      apiUrl: "https://api.xiaomimimo.com/anthropic/v1",
    });
    expect(migrated.llm.minimax).toMatchObject({
      backendKind: "openai-compatible",
      apiUrl: "https://api.minimax.io/v1",
    });
    expect(migrated.llm.gemini).toBeUndefined();
    expect(migrated.aiChat.visualModelKey).toBe("openai:deployment");
    expect(mergeEditorOptions(migrated)).toEqual(migrated);
    expect(mergeEditorOptions(migrated, { llm: {} }).llm).toEqual({});
  });

  test("keeps new empty connections and isolates multiple connections to the same provider", () => {
    const app = options({
      accountA: connection(),
      accountB: {
        ...connection(),
        name: "Personal",
        apiKey: "personal-key",
        apiUrl: "https://personal.example/v1",
      },
    });
    expect(Object.keys(normalizeAiConnections(app.llm))).toEqual([
      "accountA",
      "accountB",
    ]);
    expect(
      normalizeAiConnections({ empty: createAiConnection() }).empty,
    ).toBeDefined();
    expect(getConfiguredAiSdkProvider(app, "accountB")).toMatchObject({
      providerId: "accountB",
      catalogId: "openai",
      apiKey: "personal-key",
      baseURL: "https://personal.example/v1",
    });
    expect(
      getAiSdkModelGroups({
        appOptions: app,
        modelCache: {},
        kind: "chat",
      }).map((group) => group.label),
    ).toEqual(["OpenAI (1)", "OpenAI (2)"]);
    expect(parseAiSdkModelSpecifier("accountA:vendor/model:variant")).toEqual({
      providerId: "accountA",
      modelId: "vendor/model:variant",
    });
    expect(parseAiSdkModelSpecifier("__proto__:model")).toBeNull();
  });

  test("retains selections and ignores retired custom model capability overrides", () => {
    const savedConnection = {
      ...connection(),
      customModels: [
        { id: "gpt-4.1", capabilities: ["text"] },
        { id: "retired-deployment", capabilities: ["text", "tools"] },
      ],
    };
    const app = options({
      accountA: savedConnection,
      accountB: connection(),
    });
    const selected = resolveAiSdkModelSpecifierForTask({
      appOptions: app,
      modelCache: {},
      kind: "chat",
      modelKey: "accountB:deployment",
    });
    expect(selected).toEqual({ providerId: "accountB", modelId: "deployment" });
    expect(() =>
      resolveAiSdkModelSpecifierForTask({
        appOptions: app,
        modelCache: {},
        kind: "chat",
        modelKey: "deleted-account:deployment",
      }),
    ).toThrow("unavailable");
    const group = getAiSdkProviderModelOptions({
      appOptions: app,
      modelCache: {},
      providerId: "accountA",
      kind: "translate",
    });
    expect(
      group.find((model) => model.id === "gpt-4.1")?.capabilities,
    ).toMatchObject({ supportsToolCalls: true, supportsImageInput: true });
    expect(group.some((model) => model.id === "retired-deployment")).toBe(
      false,
    );
    expect(mergeEditorOptions(app).llm.accountA).not.toHaveProperty(
      "customModels",
    );
  });

  test("does not infer image or tool support from an unknown model ID", async () => {
    const app = options({
      local: {
        ...createAiConnection(),
        apiUrl: "http://localhost:1234/v1",
        authMode: "none",
      },
    });
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: [
          { id: "gpt-unknown-vision" },
          { id: "text-embedding-3-small" },
          { id: "whisper-1" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const models = await getAiSdkModelCatalogProvider("local").fetchModels({
      appOptions: app,
    });
    expect(models).toHaveLength(1);
    expect(models[0].capabilities).toMatchObject({
      supportsImageInput: false,
      supportsToolCalls: false,
    });
    expect(
      new Headers(fetcher.mock.calls[0]?.[1]?.headers).has("Authorization"),
    ).toBe(false);
  });

  test("prefers endpoint availability and explicit facts over catalog assumptions", async () => {
    const app = options({ accountA: connection() });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            {
              id: "gpt-4.1",
              supported_parameters: [],
              input_modalities: ["text"],
              context_length: 32000,
            },
          ],
        }),
      ),
    );
    const models = await getAiSdkModelCatalogProvider("accountA").fetchModels({
      appOptions: app,
    });
    expect(models).toHaveLength(1);
    expect(models[0].capabilities).toMatchObject({
      supportsToolCalls: false,
      supportsImageInput: false,
      contextWindowTokens: 32000,
    });
    const group = getAiSdkProviderModelOptions({
      appOptions: app,
      modelCache: { accountA: { models: [], fetchedAt: Date.now() } },
      providerId: "accountA",
      kind: "chat",
    });
    expect(group).toEqual([]);
  });

  test("retains SDK reasoning namespaces for a connection with an independent ID", () => {
    const config = getConfiguredAiSdkProvider(
      options({ accountA: connection() }),
      "accountA",
    )!;
    const runtime = getAiRuntimeAdapter(config);
    const reasoning = runtime.resolveReasoning({
      providerId: "accountA",
      backendKind: "openai",
      modelId: "gpt-5.4",
      task: "chat",
      appOptions: options({ accountA: connection() }),
      preference: { level: "high", displayPolicy: "summary" },
    });
    expect(reasoning.callOptions?.providerOptions).toEqual({
      openai: { forceReasoning: true, reasoningEffort: "high" },
    });
  });
});

describe("models.dev catalog", () => {
  test("accepts new provider IDs through supported protocols and ignores unsupported SDKs", () => {
    const parsed = parseModelsDevCatalog({
      ...externalCatalog,
      unsupported: {
        ...externalCatalog["new-service"],
        npm: "uninstalled-sdk",
      },
    });
    expect(Object.keys(parsed)).toEqual(["new-service"]);
    expect(parsed["new-service"].models["new-model"].limit?.context).toBe(
      64000,
    );
    expect(() => parseModelsDevCatalog({ bad: {} })).toThrow();
  });

  test("refreshes provider and model data without overwriting a saved endpoint, and retains valid data after failure", async () => {
    const app = options({ saved: connection() });
    const before = structuredClone(app);
    const original = Object.fromEntries(
      getModelsDevProviders().map((spec) => [
        spec.id,
        getModelsDevProvider(spec.id),
      ]),
    );
    try {
      await refreshModelsDev({
        force: true,
        fetch: vi.fn(async () => Response.json(externalCatalog)),
      });
      const spec = getModelsDevProviders().find(
        (provider) => provider.id === "new-service",
      )!;
      expect(spec).toMatchObject({
        backendKind: "openai-compatible",
        defaultBaseUrl: "https://new.example/v1",
      });
      const appWithNew = options({
        dynamic: { ...createAiConnection(spec), apiKey: "new-key" },
      });
      expect(
        getAiSdkModelGroups({
          appOptions: appWithNew,
          modelCache: {},
          kind: "vision",
        })[0].models[0].id,
      ).toBe("new-model");
      expect(getConfiguredAiSdkProvider(appWithNew, "dynamic")).toMatchObject({
        backendKind: "openai-compatible",
        baseURL: "https://new.example/v1",
      });
      await expect(
        refreshModelsDev({
          force: true,
          fetch: vi.fn(async () => Response.json({ broken: true })),
        }),
      ).rejects.toThrow();
      expect(getModelsDevProvider("new-service")).toBeDefined();
      expect(app).toEqual(before);
    } finally {
      await refreshModelsDev({
        force: true,
        fetch: vi.fn(async () => Response.json(original)),
      });
    }
  });
});
