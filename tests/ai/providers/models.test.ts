import { describe, expect, test } from "vitest";

import { DEFAULT_EDITOR_UI_STATE } from "@/constants";
import {
  getAiSdkProviderModelOptions,
  resolveAiSdkModelSpecifierForTask,
} from "@/services/ai/providers/modelResolver";
import { getCuratedAiProviderModels } from "@/services/ai/providers/models";
import { getAiRuntimeAdapter } from "@/services/ai/providers/registry";
import { getConfiguredAiSdkProvider } from "@/services/ai/providers/settings";
import { mimoAdapter } from "@/services/ai/providers/runtimeAdapters/mimo";
import { openAiAdapter } from "@/services/ai/providers/runtimeAdapters/openai";
import { normalizeReasoningPreference } from "@/services/ai/providers/runtimeAdapters/shared";
import { createEmptyLlmModelCache } from "@/store/helpers";
import type { AppOptions, LLMCustomModelConfig } from "@/types";

const createOptions = (options: {
  openAiApiUrl: string;
  openAiCompatibleApiUrl?: string;
  xiaomiMimoApiOptionId?: string;
  xiaomiMimoApiUrl?: string;
  minimaxApiOptionId?: string;
  openAiCustomModels?: LLMCustomModelConfig[];
  openAiCompatibleCustomModels?: LLMCustomModelConfig[];
  geminiCustomModels?: LLMCustomModelConfig[];
}): AppOptions => ({
  ...DEFAULT_EDITOR_UI_STATE.options,
  llm: {
    ...DEFAULT_EDITOR_UI_STATE.options.llm,
    openai: {
      ...DEFAULT_EDITOR_UI_STATE.options.llm.openai,
      enabled: true,
      apiKey: "test-key",
      apiUrl: options.openAiApiUrl,
      customModels: options.openAiCustomModels ?? [],
    },
    "openai-compatible": {
      ...DEFAULT_EDITOR_UI_STATE.options.llm["openai-compatible"],
      enabled: true,
      apiKey: "test-key",
      apiUrl: options.openAiCompatibleApiUrl ?? "",
      customModels: options.openAiCompatibleCustomModels ?? [],
    },
    "xiaomi-mimo": {
      ...DEFAULT_EDITOR_UI_STATE.options.llm["xiaomi-mimo"],
      enabled: true,
      apiKey: "test-key",
      apiOptionId: options.xiaomiMimoApiOptionId ?? "openai",
      apiUrl: options.xiaomiMimoApiUrl ?? "",
      customModels: [],
    },
    minimax: {
      ...DEFAULT_EDITOR_UI_STATE.options.llm.minimax,
      enabled: true,
      apiKey: "test-key",
      apiOptionId: options.minimaxApiOptionId ?? "anthropic",
      customModels: [],
    },
    gemini: {
      ...DEFAULT_EDITOR_UI_STATE.options.llm.gemini,
      enabled: true,
      apiKey: "test-key",
      customModels: options.geminiCustomModels ?? [],
    },
  },
});

const getModelIds = (
  providerId: "openai" | "openai-compatible" | "xiaomi-mimo" | "gemini",
  options: AppOptions,
  kind: "chat" | "vision",
) =>
  getAiSdkProviderModelOptions({
    appOptions: options,
    modelCache: createEmptyLlmModelCache(),
    providerId,
    kind,
  }).map((model) => model.id);

const getModels = (
  providerId: "openai" | "openai-compatible" | "xiaomi-mimo" | "gemini",
  options: AppOptions,
  kind: "chat" | "vision",
) =>
  getAiSdkProviderModelOptions({
    appOptions: options,
    modelCache: createEmptyLlmModelCache(),
    providerId,
    kind,
  });

describe("AI provider model definitions", () => {
  test("orders provider models by rank before falling back to source order", () => {
    const options = createOptions({
      openAiApiUrl: "https://api.openai.com/v1",
    });

    const openAiVisionModelIds = getModelIds("openai", options, "vision");
    const geminiVisionModelIds = getModelIds("gemini", options, "vision");
    const xiaomiVisionModelIds = getModelIds("xiaomi-mimo", options, "vision");

    expect(openAiVisionModelIds[0]).toBe("gpt-5.5");
    expect(openAiVisionModelIds.indexOf("gpt-5.5")).toBeLessThan(
      openAiVisionModelIds.indexOf("gpt-4.1"),
    );
    expect(geminiVisionModelIds[0]).toBe("gemini-3.5-flash");
    expect(geminiVisionModelIds.indexOf("gemini-3.5-flash")).toBeLessThan(
      geminiVisionModelIds.indexOf("gemini-2.5-pro"),
    );
    expect(xiaomiVisionModelIds[0]).toBe("mimo-v2.5");
  });

  test("auto vision task resolution skips configured text-only providers", () => {
    const appOptions: AppOptions = {
      ...DEFAULT_EDITOR_UI_STATE.options,
      llm: {
        ...DEFAULT_EDITOR_UI_STATE.options.llm,
        "openai-compatible": {
          ...DEFAULT_EDITOR_UI_STATE.options.llm["openai-compatible"],
          enabled: true,
          apiKey: "test-key",
          apiUrl: "https://example.test/v1",
          customModels: [
            {
              id: "text-only-tools",
              capabilities: ["text", "tools"],
            },
          ],
        },
        gemini: {
          ...DEFAULT_EDITOR_UI_STATE.options.llm.gemini,
          enabled: true,
          apiKey: "test-key",
          customModels: [],
        },
      },
    };

    const specifier = resolveAiSdkModelSpecifierForTask({
      appOptions,
      modelCache: createEmptyLlmModelCache(),
      kind: "vision",
    });

    expect(specifier.providerId).toBe("gemini");
  });

  test("auto vision task resolution prefers the current provider when it has vision models", () => {
    const appOptions = createOptions({
      openAiApiUrl: "https://api.openai.com/v1",
    });

    const xiaomiSpecifier = resolveAiSdkModelSpecifierForTask({
      appOptions,
      modelCache: createEmptyLlmModelCache(),
      kind: "vision",
      preferredProviderId: "xiaomi-mimo",
    });
    expect(xiaomiSpecifier).toEqual({
      providerId: "xiaomi-mimo",
      modelId: "mimo-v2.5",
    });

    const minimaxSpecifier = resolveAiSdkModelSpecifierForTask({
      appOptions,
      modelCache: createEmptyLlmModelCache(),
      kind: "vision",
      preferredProviderId: "minimax",
    });
    expect(minimaxSpecifier.providerId).toBe("openai");
    expect(minimaxSpecifier.modelId).toBe("gpt-5.5");
  });

  test("adds current curated Gemini chat models from central metadata", () => {
    const chatModelIds = getModelIds(
      "gemini",
      createOptions({
        openAiApiUrl: "https://api.openai.com/v1",
      }),
      "chat",
    );

    expect(chatModelIds).toEqual(
      expect.arrayContaining([
        "gemini-3.5-flash",
        "gemini-3.1-pro-preview",
        "gemini-3.1-flash-lite",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
      ]),
    );
    expect(chatModelIds).not.toContain("gemini-3.1-flash-image-preview");
    expect(chatModelIds).not.toContain("gemini-3:text-family");

    const latest = getModels(
      "gemini",
      createOptions({
        openAiApiUrl: "https://api.openai.com/v1",
      }),
      "vision",
    ).find((model) => model.id === "gemini-3.5-flash");
    expect(latest?.capabilities.supportsToolCalls).toBe(true);
    expect(latest?.capabilities.supportsImageInput).toBe(true);
  });

  test("adds curated Xiaomi MiMo models only under the Xiaomi provider", () => {
    const xiaomiModelIds = getModelIds(
      "xiaomi-mimo",
      createOptions({
        openAiApiUrl: "https://api.openai.com/v1",
      }),
      "chat",
    );
    expect(xiaomiModelIds).toEqual(
      expect.arrayContaining([
        "mimo-v2.5-pro",
        "mimo-v2.5",
        "mimo-v2-pro",
        "mimo-v2-omni",
        "mimo-v2-flash",
      ]),
    );

    const officialOpenAiModelIds = getModelIds(
      "openai",
      createOptions({
        openAiApiUrl: "https://api.openai.com/v1",
      }),
      "chat",
    );
    expect(officialOpenAiModelIds.some((id) => id.startsWith("mimo-v2"))).toBe(
      false,
    );
    expect(
      getModels(
        "openai",
        createOptions({
          openAiApiUrl: "https://api.openai.com/v1",
        }),
        "chat",
      ).find((model) => model.id === "gpt-4.1")?.capabilities
        .supportsImageToolResults,
    ).toBe(true);
    expect(officialOpenAiModelIds).toEqual(
      expect.arrayContaining(["gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.5"]),
    );

    const compatibleModelIds = getModelIds(
      "openai-compatible",
      createOptions({
        openAiApiUrl: "https://api.openai.com/v1",
        openAiCompatibleApiUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
      }),
      "chat",
    );
    expect(compatibleModelIds.some((id) => id.startsWith("mimo-v2"))).toBe(
      false,
    );

    const options = createOptions({
      openAiApiUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
      openAiCompatibleApiUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
      xiaomiMimoApiUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
    });
    expect(getConfiguredAiSdkProvider(options, "openai")?.baseURL).toBe(
      "https://token-plan-sgp.xiaomimimo.com/v1",
    );
    expect(
      getAiRuntimeAdapter(getConfiguredAiSdkProvider(options, "openai")!),
    ).toBe(openAiAdapter);
    expect(
      getAiRuntimeAdapter(
        getConfiguredAiSdkProvider(options, "openai-compatible")!,
      ),
    ).not.toBe(mimoAdapter);
    expect(
      getAiRuntimeAdapter(getConfiguredAiSdkProvider(options, "xiaomi-mimo")!),
    ).toBe(mimoAdapter);

    const anthropicOptions = createOptions({
      openAiApiUrl: "https://api.openai.com/v1",
      xiaomiMimoApiOptionId: "anthropic",
    });
    expect(
      getConfiguredAiSdkProvider(anthropicOptions, "xiaomi-mimo")?.baseURL,
    ).toBe("https://api.xiaomimimo.com/anthropic/v1");
    expect(
      getConfiguredAiSdkProvider(anthropicOptions, "xiaomi-mimo")?.backendKind,
    ).toBe("anthropic-compatible");
    expect(
      getAiRuntimeAdapter(
        getConfiguredAiSdkProvider(anthropicOptions, "xiaomi-mimo")!,
      ),
    ).not.toBe(mimoAdapter);
  });

  test("uses generic compatible adapters for MiniMax API formats", () => {
    const anthropicOptions = createOptions({
      openAiApiUrl: "https://api.openai.com/v1",
      minimaxApiOptionId: "anthropic",
    });
    const anthropicConfig = getConfiguredAiSdkProvider(
      anthropicOptions,
      "minimax",
    )!;
    expect(anthropicConfig.backendKind).toBe("anthropic-compatible");
    expect(
      getAiRuntimeAdapter(anthropicConfig).resolveReasoning({
        providerId: "minimax",
        backendKind: anthropicConfig.backendKind,
        apiOptionId: anthropicConfig.apiOptionId,
        modelId: "MiniMax-M2.7",
        task: "chat",
        appOptions: anthropicOptions,
        preference: normalizeReasoningPreference({
          level: "high",
          displayPolicy: "summary",
        }),
      }).capability.supported,
    ).toBe(true);

    const openAiOptions = createOptions({
      openAiApiUrl: "https://api.openai.com/v1",
      minimaxApiOptionId: "openai",
    });
    const openAiConfig = getConfiguredAiSdkProvider(openAiOptions, "minimax")!;
    expect(openAiConfig.backendKind).toBe("openai-compatible");
    expect(
      getAiRuntimeAdapter(openAiConfig).resolveReasoning({
        providerId: "minimax",
        backendKind: openAiConfig.backendKind,
        apiOptionId: openAiConfig.apiOptionId,
        modelId: "MiniMax-M2.7",
        task: "chat",
        appOptions: openAiOptions,
        preference: normalizeReasoningPreference({
          level: "high",
          displayPolicy: "summary",
        }),
      }).capability.supported,
    ).toBe(false);
  });

  test("exposes MiniMax and Zhipu curated models without list-only duplicate rules", () => {
    const minimaxModelIds = getCuratedAiProviderModels({
      providerId: "minimax",
    }).map((model) => model.id);
    const zhipuModelIds = getCuratedAiProviderModels({
      providerId: "zhipu",
    }).map((model) => model.id);

    expect(minimaxModelIds).toEqual(
      expect.arrayContaining(["MiniMax-M2.7", "MiniMax-M2"]),
    );
    expect(zhipuModelIds).toEqual(
      expect.arrayContaining(["glm-5.1", "glm-4.7", "glm-4.6v-flash"]),
    );
    expect(new Set(minimaxModelIds).size).toBe(minimaxModelIds.length);
    expect(new Set(zhipuModelIds).size).toBe(zhipuModelIds.length);
  });

  test("uses central model metadata to expose MiMo vision-capable models", () => {
    const visionModelIds = getModelIds(
      "xiaomi-mimo",
      createOptions({
        openAiApiUrl: "https://api.openai.com/v1",
      }),
      "vision",
    );

    expect(visionModelIds).toEqual(
      expect.arrayContaining(["mimo-v2.5", "mimo-v2-omni"]),
    );
    expect(visionModelIds).not.toContain("mimo-v2-flash");
    expect(visionModelIds).not.toContain("mimo-v2-pro");

    const xiaomiModels = getModels(
      "xiaomi-mimo",
      createOptions({
        openAiApiUrl: "https://api.openai.com/v1",
      }),
      "chat",
    );
    expect(
      xiaomiModels.find((model) => model.id === "mimo-v2.5")?.capabilities
        .supportsImageToolResults,
    ).toBe(false);
  });

  test("does not apply MiMo metadata to generic compatible custom models", () => {
    const compatibleVisionModelIds = getModelIds(
      "openai-compatible",
      createOptions({
        openAiApiUrl: "https://api.openai.com/v1",
        openAiCompatibleCustomModels: [
          {
            id: "mimo-v2-omni",
            capabilities: ["text", "tools"],
          },
        ],
      }),
      "vision",
    );

    expect(compatibleVisionModelIds).not.toContain("mimo-v2-omni");

    const officialVisionModelIds = getModelIds(
      "openai",
      createOptions({
        openAiApiUrl: "https://api.openai.com/v1",
        openAiCustomModels: [
          {
            id: "mimo-v2-omni",
            capabilities: ["text", "tools"],
          },
        ],
      }),
      "vision",
    );

    expect(officialVisionModelIds).not.toContain("mimo-v2-omni");
  });
});
