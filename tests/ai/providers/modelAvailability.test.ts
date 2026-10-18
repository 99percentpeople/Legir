import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { DEFAULT_EDITOR_UI_STATE } from "@/constants";
import { createAiConnection } from "@/services/ai/providers/connections";
import {
  getAiSdkModelGroups,
  getAiSdkProviderModelOptions,
} from "@/services/ai/providers/modelSelection";
import { getAiSdkModelCatalogProvider } from "@/services/ai/providers/modelCatalogRegistry";
import { resolveAiSdkModelSpecifierForTask } from "@/services/ai/providers/modelResolver";
import { initializeModelsDev } from "@/services/ai/providers/modelsDev";
import { createAiDiscoveredModel } from "@/services/ai/providers/models";
import {
  getChatModelGroups,
  getVisionModelGroups,
  subscribeLLMModelRegistry,
} from "@/services/ai/modelCache";
import { translateService } from "@/services/translateService";
import {
  preferencesStore,
  setPreferenceOptions,
} from "@/store/preferencesStore";
import type { AiSdkTaskModelKind } from "@/services/ai/providers/types";
import type { AppOptions, EditorState } from "@/types";

const initial = preferencesStore.getState();
beforeAll(() => initializeModelsDev());
afterEach(() => {
  preferencesStore.setState(initial);
  vi.unstubAllGlobals();
});
const connection = () => ({
  ...createAiConnection({
    id: "openai",
    label: "OpenAI",
    backendKind: "openai",
    defaultBaseUrl: "https://example.com/v1",
  }),
  apiKey: "saved-key",
});
const appOptions = (): AppOptions => ({
  ...DEFAULT_EDITOR_UI_STATE.options,
  llm: {
    key: connection(),
    token: {
      ...connection(),
      catalogId: "anthropic",
      backendKind: "anthropic-compatible",
      authMode: "bearer",
      apiKey: "saved-token",
    },
    local: {
      ...connection(),
      authMode: "none",
      apiKey: "",
      apiUrl: "http://localhost:1234/v1",
    },
    disabled: { ...connection(), enabled: false },
    missingKey: { ...connection(), apiKey: "" },
    whitespaceKey: { ...connection(), apiKey: " \n\t " },
    emptyToken: {
      ...connection(),
      backendKind: "anthropic-compatible",
      authMode: "bearer",
      apiKey: "",
    },
    missingUrl: { ...connection(), apiUrl: "" },
    invalidUrl: { ...connection(), apiUrl: "not-a-url" },
    invalidScheme: { ...connection(), apiUrl: "file:///tmp/models" },
    embeddedCredentials: {
      ...connection(),
      apiUrl: "https://user:pass@example.com/v1",
    },
    noAuthWithoutUrl: {
      ...connection(),
      authMode: "none",
      apiKey: "",
      apiUrl: "",
    },
    disabledNoAuth: {
      ...connection(),
      authMode: "none",
      apiKey: "",
      enabled: false,
    },
  },
});
const modelCache = (app: AppOptions): EditorState["llmModelCache"] =>
  Object.fromEntries(
    Object.keys(app.llm).map((id) => [
      id,
      {
        models: [
          createAiDiscoveredModel({
            modelId: "cached-model",
            inputModalities: ["text", "image"],
            supportsToolCalls: true,
          }),
        ],
        fetchedAt: Date.now(),
      },
    ]),
  );

describe("model picker availability", () => {
  for (const source of ["catalog", "cache"] as const) {
    test.each<AiSdkTaskModelKind>(["chat", "vision", "translate", "summarize"])(
      `only shows enabled, configured providers for %s models from ${source}`,
      (kind) => {
        const app = appOptions();
        const cache = source === "cache" ? modelCache(app) : {};
        const fetcher = vi.fn();
        vi.stubGlobal("fetch", fetcher);
        const groups = getAiSdkModelGroups({
          appOptions: app,
          modelCache: cache,
          kind,
        });
        expect(groups.map((group) => group.providerId).sort()).toEqual([
          "key",
          "local",
          "token",
        ]);
        expect(
          Object.fromEntries(
            groups.map((group) => [group.providerId, group.catalogId]),
          ),
        ).toEqual({ key: "openai", local: "openai", token: "anthropic" });
        expect(
          groups.every((group) => group.isAvailable && group.models.length > 0),
        ).toBe(true);
        for (const id of Object.keys(app.llm).filter(
          (id) => !["key", "local", "token"].includes(id),
        )) {
          expect(
            getAiSdkProviderModelOptions({
              appOptions: app,
              modelCache: cache,
              providerId: id,
              kind,
            }),
          ).toEqual([]);
          expect(
            getAiSdkModelCatalogProvider(id).getModelsForTask({
              appOptions: app,
              modelCache: cache,
              kind,
            }),
          ).toEqual([]);
        }
        // Filling a credential is not a server-side authentication check.
        expect(fetcher).not.toHaveBeenCalled();
      },
    );
  }

  test("hides empty model groups and retains explicitly saved model selections", () => {
    const app = appOptions();
    app.aiChat = { ...app.aiChat, visualModelKey: "disabled:cached-model" };
    const cache = modelCache(app);
    cache.key.models = [];
    expect(
      getAiSdkModelGroups({
        appOptions: app,
        modelCache: cache,
        kind: "vision",
      })
        .map((group) => group.providerId)
        .sort(),
    ).toEqual(["local", "token"]);
    expect(app.aiChat.visualModelKey).toBe("disabled:cached-model");
    expect(() =>
      resolveAiSdkModelSpecifierForTask({
        appOptions: app,
        modelCache: cache,
        kind: "vision",
        modelKey: app.aiChat.visualModelKey,
      }),
    ).toThrow("unavailable");
  });

  test("updates chat, vision and translation choices immediately without model discovery", () => {
    const app = { ...appOptions(), llm: { account: connection() } };
    preferencesStore.setState({ options: app, llmModelCache: modelCache(app) });
    const changed = vi.fn();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const unsubscribe = subscribeLLMModelRegistry(changed);
    const expectVisible = (visible: boolean) => {
      expect(
        getChatModelGroups().some((group) => group.providerId === "account"),
      ).toBe(visible);
      expect(
        getVisionModelGroups().some((group) => group.providerId === "account"),
      ).toBe(visible);
      expect(
        translateService
          .getOptionGroups()
          .some((group) => group.id === "account"),
      ).toBe(visible);
    };
    const patch = (value: Partial<AppOptions["llm"][string]>) => {
      setPreferenceOptions((current) => ({
        llm: { account: { ...current.llm.account, ...value } },
      }));
    };
    try {
      expectVisible(true);
      patch({ enabled: false });
      expectVisible(false);
      patch({ enabled: true });
      expectVisible(true);
      patch({ apiKey: "   " });
      expectVisible(false);
      patch({ authMode: "none" });
      expectVisible(true);
      patch({ authMode: "api-key" });
      expectVisible(false);
      patch({ apiKey: "replacement-key" });
      expectVisible(true);
      expect(changed).toHaveBeenCalledTimes(6);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});
