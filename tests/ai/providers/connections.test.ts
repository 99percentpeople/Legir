import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { generateText } from "ai";
import { DEFAULT_EDITOR_UI_STATE } from "@/constants";
import { createAiConnection } from "@/services/ai/providers/connections";
import { getConfiguredAiSdkProvider } from "@/services/ai/providers/settings";
import { getAiRuntimeAdapter } from "@/services/ai/providers/registry";
import { getAiSdkModelCatalogProvider } from "@/services/ai/providers/modelCatalogRegistry";
import {
  initializeModelsDev,
  refreshModelsDev,
} from "@/services/ai/providers/modelsDev";
import {
  getConnectionCacheKey,
  MODEL_CACHE_TTL_MS,
} from "@/services/ai/providers/modelCatalog/base";
import { loadModels } from "@/services/ai/modelCache";
import {
  createPreferencesStore,
  preferencesStore,
  setPreferenceOptions,
} from "@/store/preferencesStore";
import type { AppOptions } from "@/types";

const initial = preferencesStore.getState();
const appOptions = (): AppOptions => ({
  ...DEFAULT_EDITOR_UI_STATE.options,
  llm: {
    work: {
      ...createAiConnection(),
      name: "Work",
      apiUrl: "https://work.example/v1",
      apiKey: "first-key",
    },
  },
});
const catalog = {
  example: {
    name: "Example",
    npm: "@ai-sdk/openai-compatible",
    api: "https://example.com/v1",
    models: {
      model: {
        name: "Model",
        tool_call: true,
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 64000 },
      },
    },
  },
};
beforeAll(async () => {
  await initializeModelsDev();
  await refreshModelsDev({
    force: true,
    fetch: vi.fn(async () => Response.json(catalog)),
  });
});
afterEach(() => {
  preferencesStore.setState(initial);
  vi.unstubAllGlobals();
  localStorage.removeItem("legir.preferences");
});

describe("connection transport and persistence", () => {
  test("routes two compatible connections to their own URL and credentials through AI SDK", async () => {
    const app = appOptions();
    app.llm.personal = {
      ...app.llm.work,
      name: "Personal",
      apiUrl: "https://personal.example/v1",
      apiKey: "second-key",
    };
    app.llm.local = {
      ...app.llm.work,
      authMode: "none",
      apiUrl: "http://localhost:1234/v1",
    };
    const calls: Array<{ url: string; key: string | null; model: string }> = [];
    for (const id of ["work", "personal", "local"]) {
      const config = getConfiguredAiSdkProvider(app, id)!;
      const provider = await getAiRuntimeAdapter(config).createSdkProvider({
        ...config,
        fetch: async (input, init) => {
          calls.push({
            url: String(input),
            key: new Headers(init?.headers).get("authorization"),
            model: JSON.parse(String(init?.body)).model,
          });
          return Response.json({
            id: "response",
            created: 1,
            model: "deployment",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "OK" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          });
        },
      });
      const result = await generateText({
        model: provider.languageModel("deployment"),
        prompt: "Hello",
      });
      expect(result.text).toBe("OK");
    }
    expect(calls).toEqual([
      {
        url: "https://work.example/v1/chat/completions",
        key: "Bearer first-key",
        model: "deployment",
      },
      {
        url: "https://personal.example/v1/chat/completions",
        key: "Bearer second-key",
        model: "deployment",
      },
      {
        url: "http://localhost:1234/v1/chat/completions",
        key: null,
        model: "deployment",
      },
    ]);
  });

  test("migrates persisted preferences and keeps deletion durable across reloads", () => {
    const legacy = {
      ...DEFAULT_EDITOR_UI_STATE.options,
      llm: {
        "xiaomi-mimo": {
          enabled: false,
          apiKey: "saved-key",
          apiOptionId: "anthropic",
        },
      },
    };
    localStorage.setItem(
      "legir.preferences",
      JSON.stringify({
        state: { options: legacy, translateOption: "xiaomi-mimo:mimo-v2.5" },
        version: 0,
      }),
    );
    const first = createPreferencesStore();
    expect(first.getState().options.llm["xiaomi-mimo"]).toMatchObject({
      catalogId: "xiaomi",
      enabled: false,
      authMode: "bearer",
    });
    expect(first.getState().translateOption).toBe("xiaomi-mimo:mimo-v2.5");
    first.setState({ options: { ...first.getState().options, llm: {} } });
    const second = createPreferencesStore();
    expect(second.getState().options.llm).toEqual({});
  });

  test.each([
    ["anthropic-compatible", "api-key", "x-api-key", "first-key"],
    ["anthropic-compatible", "bearer", "authorization", "Bearer first-key"],
    ["anthropic-compatible", "none", "", null],
    ["google", "api-key", "x-goog-api-key", "first-key"],
    ["google", "bearer", "x-goog-api-key", "first-key"],
    ["google", "none", "", null],
  ] as const)(
    "uses consistent %s / %s authentication for discovery and generation",
    async (backendKind, authMode, header, value) => {
      const app = appOptions();
      app.llm.work = { ...app.llm.work, backendKind, authMode };
      const calls: Headers[] = [];
      const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
        calls.push(new Headers(init?.headers));
        if (!init?.body) return Response.json({ data: [], models: [] });
        return Response.json(
          backendKind === "google"
            ? {
                candidates: [
                  {
                    content: { role: "model", parts: [{ text: "OK" }] },
                    finishReason: "STOP",
                  },
                ],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }
            : {
                id: "message",
                type: "message",
                role: "assistant",
                model: "deployment",
                content: [{ type: "text", text: "OK" }],
                stop_reason: "end_turn",
                stop_sequence: null,
                usage: { input_tokens: 1, output_tokens: 1 },
              },
        );
      });
      vi.stubGlobal("fetch", fetcher);
      await getAiSdkModelCatalogProvider("work").fetchModels({
        appOptions: app,
      });
      const config = getConfiguredAiSdkProvider(app, "work")!;
      const provider = await getAiRuntimeAdapter(config).createSdkProvider({
        ...config,
        fetch: fetcher,
      });
      const result = await generateText({
        model: provider.languageModel("deployment"),
        prompt: "Hello",
      });
      expect(result.text).toBe("OK");
      expect(calls).toHaveLength(2);
      for (const headers of calls) {
        for (const name of ["authorization", "x-api-key", "x-goog-api-key"]) {
          expect(headers.get(name)).toBe(name === header ? value : null);
        }
      }
      expect(app.llm.work.apiKey).toBe("first-key");
      expect(app.llm.work.authMode).toBe(authMode);
    },
  );
});

describe("model cache isolation", () => {
  test("refreshes expired lists, reuses fresh lists, and retains them when an endpoint fails", async () => {
    const app = appOptions();
    preferencesStore.setState({ options: app, llmModelCache: {} });
    const fetcher = vi.fn(async () =>
      Response.json({ data: [{ id: "deployment" }] }),
    );
    vi.stubGlobal("fetch", fetcher);
    await loadModels();
    await loadModels();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const first = preferencesStore.getState().llmModelCache.work;
    preferencesStore.setState({
      llmModelCache: {
        work: { ...first, fetchedAt: Date.now() - MODEL_CACHE_TTL_MS - 1 },
      },
    });
    await loadModels();
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockImplementation(
      async () => new Response("Unavailable", { status: 503 }),
    );
    await expect(
      loadModels({ force: true, throwOnError: true }),
    ).rejects.toThrow("503");
    expect(preferencesStore.getState().llmModelCache.work.models).toEqual(
      first.models,
    );
  });

  test.each(["edit", "delete"])(
    "discards an old response after connection %s",
    async (action) => {
      preferencesStore.setState({ options: appOptions(), llmModelCache: {} });
      let complete!: (response: Response) => void;
      const fetcher = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          }),
      );
      vi.stubGlobal("fetch", fetcher);
      const pending = loadModels();
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
      setPreferenceOptions(
        (current): Partial<AppOptions> => ({
          llm:
            action === "delete"
              ? {}
              : {
                  work: {
                    ...current.llm.work,
                    apiUrl: "https://changed.example/v1",
                  },
                },
        }),
      );
      complete(Response.json({ data: [{ id: "stale-model" }] }));
      await pending;
      expect(preferencesStore.getState().llmModelCache.work).toBeUndefined();
    },
  );

  test("invalidates lists when credentials change", () => {
    const first = appOptions();
    const second = {
      ...first,
      llm: { work: { ...first.llm.work, apiKey: "different-key" } },
    };
    expect(getConnectionCacheKey(first, "work")).not.toBe(
      getConnectionCacheKey(second, "work"),
    );
  });
});
