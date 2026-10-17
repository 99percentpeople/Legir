import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { generateText } from "ai";
import { DEFAULT_EDITOR_UI_STATE } from "@/constants";
import { getCatalogProviderSpec } from "@/services/ai/providers/catalog";
import { createAiConnection } from "@/services/ai/providers/connections";
import * as modelsDev from "@/services/ai/providers/modelsDev";
import { getCatalogReasoningMetadata } from "@/services/ai/providers/reasoning";
import { getAiRuntimeAdapter } from "@/services/ai/providers/registry";
import { getConfiguredAiSdkProvider } from "@/services/ai/providers/settings";
import { getReasoningLevelControl } from "@/services/ai/providers/runtimeAdapters/shared";
import type { AiReasoningLevel } from "@/services/ai/providers/runtimeAdapters/types";

beforeAll(() => modelsDev.initializeModelsDev());
afterEach(() => vi.restoreAllMocks());

const setup = (catalogId: string) => {
  const spec = getCatalogProviderSpec(
    modelsDev.getModelsDevProvider(catalogId)!,
  )!;
  const appOptions = {
    ...DEFAULT_EDITOR_UI_STATE.options,
    llm: {
      account: {
        ...createAiConnection(spec),
        apiKey: "test-key",
        apiUrl: "https://provider.example/v1",
      },
    },
  };
  const config = getConfiguredAiSdkProvider(appOptions, "account")!;
  const adapter = getAiRuntimeAdapter(config);
  const request = (modelId: string, level: AiReasoningLevel = "auto") => ({
    providerId: "account",
    backendKind: config.backendKind,
    modelId,
    task: "chat" as const,
    appOptions,
    preference: { level, displayPolicy: "summary" as const },
  });
  return { config, adapter, request };
};

describe("catalog reasoning across providers", () => {
  test.each([
    ["openai", "gpt-5.4-pro", ["auto", "medium", "high", "xhigh"]],
    [
      "anthropic",
      "claude-opus-4-7",
      ["auto", "low", "medium", "high", "xhigh", "max"],
    ],
    [
      "google",
      "gemini-3.5-flash",
      ["auto", "minimal", "low", "medium", "high"],
    ],
    ["groq", "qwen/qwen3.8-27b", ["none", "auto", "low", "medium", "high"]],
    ["xai", "grok-4.7", ["auto", "low", "medium", "high", "xhigh"]],
    [
      "openrouter",
      "openai/gpt-5.5",
      ["none", "auto", "low", "medium", "high", "xhigh"],
    ],
    ["zhipuai", "glm-5.3", ["auto", "low", "high", "max"]],
    ["moonshotai", "kimi-k3", ["auto", "low", "high", "max"]],
    ["minimax", "MiniMax-M3", ["none", "auto"]],
    ["minimax", "MiniMax-M2.7", ["auto"]],
    ["google", "gemini-2.5-flash", ["none", "auto", "low", "medium", "high"]],
  ] as const)(
    "%s / %s exposes only catalog controls",
    (catalogId, modelId, levels) => {
      const { adapter, request } = setup(catalogId);
      const capability = adapter.getReasoningCapability(request(modelId));
      expect(getReasoningLevelControl(capability)).toMatchObject({
        levels,
        showSelect: levels.length > 1,
      });
    },
  );

  test.each([
    "openai",
    "anthropic",
    "google",
    "groq",
    "xai",
    "openrouter",
    "zhipuai",
    "deepseek",
    "xiaomi",
    "moonshotai",
  ])(
    "%s discovers future model names and removes stale levels when catalog data changes",
    (provider) => {
      const { adapter, request } = setup(provider);
      const lookup = vi.spyOn(modelsDev, "getModelsDevModel");
      const model = { id: "future-alias", name: "Future", reasoning: true };
      lookup.mockReturnValue({
        ...model,
        reasoning_options: [{ type: "effort", values: ["low", "high"] }],
      });
      expect(adapter.getReasoningCapability(request(model.id)).levels).toEqual([
        "auto",
        "low",
        "high",
      ]);
      lookup.mockReturnValue({
        ...model,
        reasoning_options: [{ type: "effort", values: ["high"] }],
      });
      const updated = adapter.resolveReasoning(request(model.id, "low"));
      expect(updated.capability.levels).toEqual(["auto", "high"]);
      expect(updated.effectivePreference.level).toBe("high");
      lookup.mockReturnValue({ ...model, reasoning: false });
      expect(
        adapter.resolveReasoning(request(model.id)).callOptions,
      ).toBeUndefined();
    },
  );

  test("does not infer support from familiar model names or an unconfigured catalog", () => {
    for (const [provider, model] of [
      ["openai", "gpt-5-future"],
      ["anthropic", "claude-opus-future"],
      ["deepseek", "deepseek-future-reasoner"],
      ["", "gpt-5.4"],
    ]) {
      expect(getCatalogReasoningMetadata(provider, model).supported).toBe(
        false,
      );
    }
  });

  test("uses the connection's catalog, not the native SDK provider's catalog", () => {
    const { config, request } = setup("openai");
    const lookup = vi
      .spyOn(modelsDev, "getModelsDevModel")
      .mockImplementation((provider) =>
        provider === "new-service"
          ? {
              id: "gpt-5.4",
              name: "Relay model",
              reasoning: true,
              reasoning_options: [{ type: "effort", values: ["high"] }],
            }
          : undefined,
      );
    const adapter = getAiRuntimeAdapter({
      ...config,
      catalogId: "new-service",
      runtimeProviderId: "new-service",
    });
    expect(adapter.getReasoningCapability(request("gpt-5.4")).levels).toEqual([
      "auto",
      "high",
    ]);
    expect(lookup).toHaveBeenCalledWith("new-service", "gpt-5.4");
  });

  test("bounds and deduplicates budget presets, preserves zero and rejects impossible ranges", () => {
    const model = {
      id: "budget-model",
      name: "Budget",
      reasoning: true,
      modalities: { input: ["text"], output: ["text"] },
      limit: { output: 6000 },
      reasoning_options: [{ type: "budget_tokens", min: 0, max: 8000 }],
    };
    const catalog = modelsDev.parseModelsDevCatalog({
      google: {
        ...modelsDev.getModelsDevProvider("google"),
        models: { [model.id]: model },
      },
    });
    const parsed = catalog.google.models[model.id];
    expect(parsed.reasoning_options?.[0].min).toBe(0);
    const lookup = vi
      .spyOn(modelsDev, "getModelsDevModel")
      .mockReturnValue(parsed);
    expect(getCatalogReasoningMetadata("google", model.id)).toMatchObject({
      levels: ["none", "auto", "low", "medium", "high"],
      budgetTokensByLevel: { low: 1024, medium: 4096, high: 5999 },
    });
    lookup.mockReturnValue({
      ...model,
      reasoning_options: [{ type: "budget_tokens", min: 5000, max: 5500 }],
    });
    expect(getCatalogReasoningMetadata("google", model.id)).toMatchObject({
      levels: ["auto", "low", "high"],
      budgetTokensByLevel: { low: 5000, medium: 5000, high: 5500 },
    });
    lookup.mockReturnValue({
      ...model,
      reasoning_options: [{ type: "budget_tokens", min: 9000, max: 10000 }],
    });
    expect(getCatalogReasoningMetadata("google", model.id)).toMatchObject({
      levels: ["auto"],
    });
    expect(
      getCatalogReasoningMetadata("google", model.id).budgetTokensByLevel,
    ).toBeUndefined();
  });

  test("does not guess nonstandard toggle or budget fields for a generic endpoint", () => {
    const { adapter, request } = setup("moonshotai");
    vi.spyOn(modelsDev, "getModelsDevModel").mockReturnValue({
      id: "new-model",
      name: "New",
      reasoning: true,
      reasoning_options: [
        { type: "toggle" },
        { type: "budget_tokens", max: 8192 },
      ],
    });
    const result = adapter.resolveReasoning(request("new-model", "high"));
    expect(result.capability.levels).toEqual(["auto"]);
    expect(result.callOptions).toBeUndefined();
  });
});

describe("SDK reasoning request serialization", () => {
  test.each<[string, string, AiReasoningLevel, Record<string, unknown>]>([
    ["openai", "gpt-6.1-sol", "max", { reasoning: { effort: "max" } }],
    [
      "anthropic",
      "claude-opus-4-7",
      "max",
      {
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "max" },
      },
    ],
    [
      "anthropic",
      "claude-sonnet-4-5",
      "high",
      { thinking: { type: "enabled", budget_tokens: 8192 } },
    ],
    [
      "google",
      "gemini-3.5-flash",
      "minimal",
      {
        generationConfig: {
          thinkingConfig: { thinkingLevel: "minimal", includeThoughts: true },
        },
      },
    ],
    [
      "google",
      "gemini-2.5-flash",
      "high",
      {
        generationConfig: {
          thinkingConfig: { thinkingBudget: 8192, includeThoughts: true },
        },
      },
    ],
    [
      "groq",
      "qwen/qwen3.8-27b",
      "auto",
      { reasoning_effort: "default", reasoning_format: "parsed" },
    ],
    [
      "groq",
      "qwen/qwen3.8-27b",
      "none",
      { reasoning_effort: "none", reasoning_format: "hidden" },
    ],
    ["xai", "grok-4.7", "xhigh", { reasoning_effort: "xhigh" }],
    [
      "openrouter",
      "openai/gpt-5.5",
      "xhigh",
      { reasoning: { effort: "xhigh", exclude: false } },
    ],
    [
      "openrouter",
      "openai/gpt-5.5",
      "none",
      { reasoning: { enabled: false, effort: "none", exclude: false } },
    ],
    ["zhipuai", "glm-5.3", "max", { reasoning_effort: "max" }],
    ["xiaomi", "mimo-v2.5-pro", "none", { thinking: { type: "disabled" } }],
    ["moonshotai", "kimi-k3", "max", { reasoning_effort: "max" }],
    ["minimax", "MiniMax-M3", "none", { thinking: { type: "disabled" } }],
  ])(
    "%s / %s sends the selected %s control",
    async (catalogId, modelId, level, expected) => {
      const { adapter, config, request } = setup(catalogId);
      const resolution = adapter.resolveReasoning(request(modelId, level));
      expect(resolution.effectivePreference.level).toBe(level);
      const boundary = new Error("Mock network boundary");
      let body: Record<string, unknown> | undefined;
      const provider = await adapter.createSdkProvider({
        ...config,
        fetch: async (_input, init) => {
          body = JSON.parse(String(init?.body));
          throw boundary;
        },
      });
      await expect(
        generateText({
          model: provider.languageModel(modelId),
          prompt: "Hello",
          maxRetries: 0,
          ...resolution.callOptions,
        }),
      ).rejects.toBe(boundary);
      expect(body).toMatchObject(expected);
      expect(body).not.toHaveProperty("reasoningEffort");
    },
  );
});
