import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { generateText } from "ai";
import { DEFAULT_EDITOR_UI_STATE } from "@/constants";
import { createAiConnection } from "@/services/ai/providers/connections";
import * as modelsDev from "@/services/ai/providers/modelsDev";
import { resolveAiProviderModelReasoning } from "@/services/ai/providers/metadata";
import { getConfiguredAiSdkProvider } from "@/services/ai/providers/settings";
import { getAiRuntimeAdapter } from "@/services/ai/providers/registry";
import { getReasoningLevelControl } from "@/services/ai/providers/runtimeAdapters/shared";
import type { AiReasoningLevel } from "@/services/ai/providers/runtimeAdapters/types";

beforeAll(() => modelsDev.initializeModelsDev());
afterEach(() => vi.restoreAllMocks());

const connectionId = "deepseek-account-connection";
const appOptions = {
  ...DEFAULT_EDITOR_UI_STATE.options,
  llm: {
    [connectionId]: {
      ...createAiConnection(),
      catalogId: "deepseek",
      apiKey: "test-key",
      apiUrl: "https://deepseek.example/v1",
    },
  },
};

describe("DeepSeek catalog reasoning controls", () => {
  test.each(["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro"])(
    "exposes the catalog's thinking controls for %s through a dynamic connection",
    (modelId) => {
      const config = getConfiguredAiSdkProvider(appOptions, connectionId)!;
      const adapter = getAiRuntimeAdapter(config);
      const capability = adapter.getReasoningCapability({
        providerId: connectionId,
        backendKind: config.backendKind,
        modelId,
        task: "chat",
        appOptions,
      });
      expect(getReasoningLevelControl(capability)).toEqual({
        supported: true,
        levels: ["none", "auto", "low", "high", "max"],
        selectedLevel: "auto",
        showSelect: true,
      });
    },
  );

  test("reads new model names and supported levels from the catalog without inventing controls", () => {
    const lookup = vi.spyOn(modelsDev, "getModelsDevModel");
    lookup.mockReturnValue({
      id: "new-catalog-alias",
      name: "New model",
      reasoning: true,
      reasoning_options: [{ type: "effort", values: ["low", "unknown"] }],
    });
    expect(
      resolveAiProviderModelReasoning("deepseek", "new-catalog-alias"),
    ).toMatchObject({ levels: ["auto", "low"], showSelect: true });

    lookup.mockReturnValue({
      id: "new-catalog-alias",
      name: "New model",
      reasoning: true,
      reasoning_options: [{ type: "toggle" }],
    });
    expect(
      resolveAiProviderModelReasoning("deepseek", "new-catalog-alias"),
    ).toMatchObject({ levels: ["none", "auto"], showSelect: true });

    lookup.mockReturnValue({
      id: "new-catalog-alias",
      name: "New model",
      reasoning: false,
    });
    expect(
      resolveAiProviderModelReasoning("deepseek", "new-catalog-alias"),
    ).toMatchObject({ levels: [], supported: false, showSelect: false });
  });

  test.each<[AiReasoningLevel, string, string | undefined]>([
    ["none", "disabled", undefined],
    ["auto", "enabled", undefined],
    ["low", "enabled", "low"],
    ["high", "enabled", "high"],
    ["max", "enabled", "max"],
    ["xhigh", "enabled", "max"],
  ])(
    "sends %s through the AI SDK with the selected DeepSeek wire parameters",
    async (level, thinking, effort) => {
      const config = getConfiguredAiSdkProvider(appOptions, connectionId)!;
      const adapter = getAiRuntimeAdapter(config);
      const request = {
        providerId: connectionId,
        backendKind: config.backendKind,
        modelId: "deepseek-flash",
        task: "chat" as const,
        appOptions,
        preference: { level, displayPolicy: "summary" as const },
      };
      const resolution = adapter.resolveReasoning(request);
      expect(resolution.effectivePreference.level).toBe(
        level === "xhigh" ? "max" : level,
      );
      let body: Record<string, unknown> | undefined;
      const provider = await adapter.createSdkProvider({
        ...config,
        fetch: async (input, init) => {
          expect(String(input)).toBe(
            "https://deepseek.example/v1/chat/completions",
          );
          body = JSON.parse(String(init?.body));
          return Response.json({
            id: "test-response",
            created: 1,
            model: request.modelId,
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
        model: provider.languageModel(request.modelId),
        prompt: "Hello",
        ...resolution.callOptions,
      });
      expect(result.text).toBe("OK");
      expect(body?.model).toBe("deepseek-flash");
      expect(body?.thinking).toEqual({ type: thinking });
      expect(body?.reasoning_effort).toBe(effort);
      expect(body).not.toHaveProperty("reasoningEffort");
    },
  );
});
