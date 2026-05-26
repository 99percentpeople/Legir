import { describe, expect, test } from "vitest";

import { DEFAULT_EDITOR_UI_STATE } from "@/constants";
import { DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS } from "@/constants";
import {
  mergeModelCapabilitiesWithMetadata,
  resolveAiProviderModelReasoning,
  resolveAiProviderModelMetadata,
} from "@/services/ai/providers/metadata";
import {
  createModelCapabilities,
  createOpenAiLikeModelCapabilities,
} from "@/services/ai/providers/capabilities";
import { anthropicAdapter } from "@/services/ai/providers/runtimeAdapters/anthropic";
import { createAnthropicCompatibleAdapter } from "@/services/ai/providers/runtimeAdapters/anthropicCompatible";
import { deepseekAdapter } from "@/services/ai/providers/runtimeAdapters/deepseek";
import { geminiAdapter } from "@/services/ai/providers/runtimeAdapters/gemini";
import { mimoAdapter } from "@/services/ai/providers/runtimeAdapters/mimo";
import { openAiAdapter } from "@/services/ai/providers/runtimeAdapters/openai";
import { zhipuAdapter } from "@/services/ai/providers/runtimeAdapters/zhipu";
import {
  canDisplayReasoningText,
  canPreviewCollapsedReasoningText,
  mergeAiSdkModelCallOptions,
  normalizeReasoningPreference,
} from "@/services/ai/providers/runtimeAdapters/shared";
import type {
  AiRuntimeAdapter,
  AiRuntimeRequest,
  AiReasoningPreference,
} from "@/services/ai/providers/runtimeAdapters/types";
import type { AiSdkBackendKind } from "@/services/ai/providers/types";

const minimaxAdapter = createAnthropicCompatibleAdapter("minimax");

const getBackendKindForAdapter = (
  adapter: AiRuntimeAdapter,
): AiSdkBackendKind => {
  if (adapter.providerId === "gemini") return "google";
  if (adapter.providerId === "minimax") return "anthropic-compatible";
  if (adapter.providerId === "xiaomi-mimo") return "openai-compatible";
  return adapter.providerId as AiSdkBackendKind;
};

const preference = (value?: Partial<AiReasoningPreference>) =>
  normalizeReasoningPreference({
    level: "high",
    displayPolicy: "summary",
    ...value,
  });

const createRequest = (
  adapter: AiRuntimeAdapter,
  modelId: string,
  pref = preference(),
) =>
  ({
    providerId: adapter.providerId,
    backendKind: getBackendKindForAdapter(adapter),
    modelId,
    task: "chat",
    appOptions: {
      ...DEFAULT_EDITOR_UI_STATE.options,
      aiChat: {
        ...DEFAULT_EDITOR_UI_STATE.options.aiChat,
        reasoning: pref,
      },
    },
    preference: pref,
  }) as AiRuntimeRequest & { preference: AiReasoningPreference };

describe("AI provider runtime adapters", () => {
  test("resolves provider model metadata for context windows and known reasoning", () => {
    expect(
      resolveAiProviderModelMetadata("openai", "gpt-4.1").contextWindowTokens,
    ).toBe(1_000_000);
    expect(
      resolveAiProviderModelMetadata("openai", "unknown-model")
        .contextWindowTokens,
    ).toBe(DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS);
    expect(
      resolveAiProviderModelMetadata("openrouter", "openai/gpt-4.1")
        .contextWindowTokens,
    ).toBe(1_000_000);
    expect(
      resolveAiProviderModelMetadata("openrouter", "openai/gpt-5.1").reasoning
        .supported,
    ).toBe(false);
    expect(
      resolveAiProviderModelMetadata("openrouter", "openai/gpt-5.3-codex")
        .reasoning.supported,
    ).toBe(false);
    expect(
      resolveAiProviderModelMetadata("openai", "gpt-5.1").reasoning.levels,
    ).toEqual(["none", "auto", "low", "medium", "high"]);
    expect(
      resolveAiProviderModelMetadata("openai", "gpt-5.4").contextWindowTokens,
    ).toBe(1_050_000);
    expect(
      resolveAiProviderModelMetadata("openai", "gpt-5.4-mini")
        .contextWindowTokens,
    ).toBe(400_000);
    expect(
      resolveAiProviderModelMetadata("openai", "gpt-5.4-nano")
        .contextWindowTokens,
    ).toBe(400_000);
    expect(
      resolveAiProviderModelMetadata("openai", "gpt-5.2-codex").reasoning,
    ).toMatchObject({
      levels: ["auto", "low", "medium", "high", "xhigh"],
      offStrategy: "none",
    });
    expect(
      resolveAiProviderModelMetadata("openai", "gpt-5.3-codex").reasoning,
    ).toMatchObject({
      levels: ["auto", "low", "medium", "high", "xhigh"],
      offStrategy: "none",
    });
    expect(
      resolveAiProviderModelMetadata("openai", "gpt-5-chat-latest"),
    ).toMatchObject({
      contextWindowTokens: 128_000,
      reasoning: { supported: false },
    });
    expect(
      resolveAiProviderModelMetadata("openai", "gpt-5.2-chat-latest").reasoning
        .supported,
    ).toBe(false);
    expect(
      resolveAiProviderModelMetadata("openai", "gpt-5-pro").reasoning,
    ).toMatchObject({
      levels: ["high"],
      offStrategy: "none",
    });
    expect(
      resolveAiProviderModelMetadata("openai", "gpt-4.5").reasoning.supported,
    ).toBe(false);
    expect(
      resolveAiProviderModelMetadata("anthropic", "claude-3-5-haiku-latest")
        .reasoning.supported,
    ).toBe(false);
    expect(
      resolveAiProviderModelMetadata("anthropic", "claude-3-7-sonnet-latest")
        .reasoning.supported,
    ).toBe(true);
    expect(
      resolveAiProviderModelMetadata("anthropic", "claude-haiku-4-5-20251001")
        .reasoning.supported,
    ).toBe(true);
    expect(
      resolveAiProviderModelMetadata("anthropic", "claude-opus-4-7-20260401")
        .reasoning.supported,
    ).toBe(false);

    const merged = mergeModelCapabilitiesWithMetadata(
      "gemini",
      "gemini-2.5-flash",
      createOpenAiLikeModelCapabilities({}),
    );
    expect(merged.contextWindowTokens).toBe(1_048_576);
    expect(merged.supportsImageInput).toBe(true);
    expect(merged.supportsToolCalls).toBe(true);
    expect(merged.supportsImageToolResults).toBe(true);

    const latestGemini = mergeModelCapabilitiesWithMetadata(
      "gemini",
      "gemini-3.5-flash",
      createModelCapabilities({
        inputModalities: ["text"],
        outputModalities: ["text"],
        supportsToolCalls: false,
        contextWindowTokens: 1,
      }),
    );
    expect(latestGemini.contextWindowTokens).toBe(1_048_576);
    expect(latestGemini.supportsImageInput).toBe(true);
    expect(latestGemini.supportsToolCalls).toBe(true);
    expect(
      resolveAiProviderModelMetadata("gemini", "gemini-3.5-flash").reasoning
        .supported,
    ).toBe(true);
    expect(
      resolveAiProviderModelMetadata("gemini", "gemini-3:text-family")
        .hasContextWindowMetadata,
    ).toBe(false);

    const unknownGemini = mergeModelCapabilitiesWithMetadata(
      "gemini",
      "gemini-new-media-preview",
      createModelCapabilities({
        inputModalities: ["text"],
        outputModalities: ["text"],
        supportsToolCalls: false,
      }),
    );
    expect(unknownGemini.supportsToolCalls).toBe(false);

    const prefixedGemini = mergeModelCapabilitiesWithMetadata(
      "openrouter",
      "google/gemini-2.5-flash",
      createOpenAiLikeModelCapabilities({}),
    );
    expect(prefixedGemini.contextWindowTokens).toBe(1_048_576);
    expect(prefixedGemini.supportsImageInput).toBe(true);
    expect(prefixedGemini.supportsImageToolResults).toBe(false);

    const gemini20 = mergeModelCapabilitiesWithMetadata(
      "gemini",
      "gemini-2.0-flash",
      createOpenAiLikeModelCapabilities({}),
    );
    expect(gemini20.contextWindowTokens).toBe(1_048_576);
    expect(gemini20.supportsToolCalls).toBe(true);

    expect(
      resolveAiProviderModelReasoning("openai", "gpt-5-pro").showSelect,
    ).toBe(false);
    expect(
      resolveAiProviderModelReasoning("deepseek", "deepseek-reasoner").levels,
    ).toEqual(["none", "auto"]);
    expect(
      resolveAiProviderModelReasoning("anthropic", "claude-sonnet-4-6", {
        level: "xhigh",
      }),
    ).toMatchObject({
      levels: ["none", "auto", "low", "medium", "high"],
      selectedLevel: "high",
      showSelect: true,
    });
    expect(
      resolveAiProviderModelReasoning(
        "anthropic-compatible",
        "claude-sonnet-4-6",
        {
          level: "xhigh",
        },
      ),
    ).toMatchObject({
      levels: ["none", "auto", "low", "medium", "high"],
      selectedLevel: "high",
      showSelect: true,
    });

    const mimoOmni = mergeModelCapabilitiesWithMetadata(
      "xiaomi-mimo",
      "mimo-v2-omni",
      createOpenAiLikeModelCapabilities({}),
    );
    expect(mimoOmni.contextWindowTokens).toBe(256_000);
    expect(mimoOmni.supportsImageInput).toBe(true);
    expect(mimoOmni.supportsToolCalls).toBe(true);
    expect(mimoOmni.supportsImageToolResults).toBe(false);
    expect(
      mergeModelCapabilitiesWithMetadata(
        "openai-compatible",
        "mimo-v2-omni",
        createOpenAiLikeModelCapabilities({}),
      ).supportsImageInput,
    ).toBe(false);

    const zhipuVision = mergeModelCapabilitiesWithMetadata(
      "zhipu",
      "glm-5v-turbo",
      createOpenAiLikeModelCapabilities({}),
    );
    expect(zhipuVision.inputModalities).toEqual([
      "text",
      "image",
      "file",
      "video",
    ]);
    expect(zhipuVision.contextWindowTokens).toBe(200_000);
    expect(zhipuVision.supportsToolCalls).toBe(true);

    const genericVision = mergeModelCapabilitiesWithMetadata(
      "openai",
      "qwen2.5-vl-72b",
      createOpenAiLikeModelCapabilities({}),
    );
    expect(genericVision.supportsImageInput).toBe(true);
    expect(genericVision.supportsToolCalls).toBe(true);

    const embedding = mergeModelCapabilitiesWithMetadata(
      "openai",
      "text-embedding-3-small",
      createOpenAiLikeModelCapabilities({}),
    );
    expect(embedding.supportsImageInput).toBe(false);
    expect(embedding.supportsToolCalls).toBe(false);

    const groqAudio = mergeModelCapabilitiesWithMetadata(
      "groq",
      "distil-whisper-large-v3-en-audio",
      createOpenAiLikeModelCapabilities({}),
    );
    expect(groqAudio.supportsToolCalls).toBe(false);
  });

  test("DeepSeek enables thinking replay and validates assistant tool-call reasoning", () => {
    const resolution = deepseekAdapter.resolveReasoning(
      createRequest(deepseekAdapter, "deepseek-reasoner"),
    );

    expect(resolution.capability).toMatchObject({
      supported: true,
      textExposure: "raw",
      requiresReasoningReplay: "tool-calls",
    });
    expect(resolution.replayPolicy).toBe("tool-calls");
    expect(resolution.callOptions).toEqual({
      providerOptions: {
        deepseek: {
          thinking: { type: "enabled" },
        },
      },
    });
    expect(canPreviewCollapsedReasoningText(resolution)).toBe(true);

    expect(() =>
      deepseekAdapter.validateMessages?.(
        [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call_1",
                toolName: "get_pages_text",
                input: {},
              },
            ],
          },
        ],
        { reasoning: resolution } as Parameters<
          NonNullable<typeof deepseekAdapter.validateMessages>
        >[1],
      ),
    ).toThrow(/requires reasoning content/);

    expect(() =>
      deepseekAdapter.validateMessages?.(
        [
          {
            role: "assistant",
            content: [
              { type: "reasoning", text: "Need tool." },
              {
                type: "tool-call",
                toolCallId: "call_1",
                toolName: "get_pages_text",
                input: {},
              },
            ],
          },
        ],
        { reasoning: resolution } as Parameters<
          NonNullable<typeof deepseekAdapter.validateMessages>
        >[1],
      ),
    ).not.toThrow();
  });

  test("MiMo enables thinking replay for Xiaomi OpenAI-compatible models", () => {
    const resolution = mimoAdapter.resolveReasoning(
      createRequest(mimoAdapter, "mimo-v2.5-pro"),
    );

    expect(resolution.capability).toMatchObject({
      supported: true,
      textExposure: "raw",
      requiresReasoningReplay: "tool-calls",
    });
    expect(resolution.replayPolicy).toBe("tool-calls");
    expect(resolution.callOptions).toEqual({
      providerOptions: {
        mimo: {
          thinking: { type: "enabled" },
        },
      },
    });

    expect(() =>
      mimoAdapter.validateMessages?.(
        [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call_1",
                toolName: "get_pages_text",
                input: {},
              },
            ],
          },
        ],
        { reasoning: resolution } as Parameters<
          NonNullable<typeof mimoAdapter.validateMessages>
        >[1],
      ),
    ).toThrow(/requires reasoning content/);
  });

  test("OpenAI reasoning models hide non-exposed reasoning text", () => {
    const resolution = openAiAdapter.resolveReasoning(
      createRequest(openAiAdapter, "gpt-5.4-mini"),
    );

    expect(resolution.effectivePreference).toMatchObject({
      level: "high",
      displayPolicy: "hidden",
    });
    expect(resolution.callOptions).toEqual({
      providerOptions: {
        openai: {
          reasoningEffort: "high",
        },
      },
    });
    expect(canDisplayReasoningText(resolution)).toBe(false);
    expect(canPreviewCollapsedReasoningText(resolution)).toBe(false);

    const xhigh = openAiAdapter.resolveReasoning(
      createRequest(openAiAdapter, "gpt-5.4", preference({ level: "xhigh" })),
    );
    expect(xhigh.callOptions).toEqual({
      providerOptions: {
        openai: {
          reasoningEffort: "xhigh",
        },
      },
    });

    const clamped = openAiAdapter.resolveReasoning(
      createRequest(openAiAdapter, "gpt-5.1", preference({ level: "xhigh" })),
    );
    expect(clamped.effectivePreference.level).toBe("high");
    expect(clamped.callOptions).toEqual({
      providerOptions: {
        openai: {
          reasoningEffort: "high",
        },
      },
    });
  });

  test("Gemini exposes summary reasoning and respects hidden display preference", () => {
    const visible = geminiAdapter.resolveReasoning(
      createRequest(geminiAdapter, "gemini-2.5-flash"),
    );
    expect(visible.capability.textExposure).toBe("summary");
    expect(visible.callOptions).toMatchObject({
      providerOptions: {
        google: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: "high",
          },
        },
      },
    });
    expect(canDisplayReasoningText(visible)).toBe(true);
    expect(canPreviewCollapsedReasoningText(visible)).toBe(false);

    const hidden = geminiAdapter.resolveReasoning(
      createRequest(
        geminiAdapter,
        "gemini-2.5-flash",
        preference({ displayPolicy: "hidden" }),
      ),
    );
    expect(hidden.callOptions).toMatchObject({
      providerOptions: {
        google: {
          thinkingConfig: {
            includeThoughts: false,
            thinkingBudget: 8192,
          },
        },
      },
    });
  });

  test("explicitly disables switchable thinking for non-agent tasks", () => {
    const offPreference = preference({
      level: "none",
      displayPolicy: "hidden",
    });

    const deepseek = deepseekAdapter.resolveReasoning(
      createRequest(deepseekAdapter, "deepseek-reasoner", offPreference),
    );
    expect(deepseek.effectivePreference.level).toBe("none");
    expect(deepseek.replayPolicy).toBe("none");
    expect(deepseek.callOptions).toEqual({
      providerOptions: {
        deepseek: {
          thinking: { type: "disabled" },
        },
      },
    });

    const gemini = geminiAdapter.resolveReasoning(
      createRequest(geminiAdapter, "gemini-2.5-flash", offPreference),
    );
    expect(gemini.effectivePreference.level).toBe("none");
    expect(gemini.callOptions).toEqual({
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingBudget: 0,
            includeThoughts: false,
          },
        },
      },
    });
  });

  test("Anthropic summaries do not preview while MiniMax raw reasoning can preview", () => {
    const anthropic = anthropicAdapter.resolveReasoning(
      createRequest(anthropicAdapter, "claude-sonnet-4-6"),
    );
    expect(anthropic.replayPolicy).toBe("all");
    expect(anthropic.capability.textExposure).toBe("summary");
    expect(canDisplayReasoningText(anthropic)).toBe(true);
    expect(canPreviewCollapsedReasoningText(anthropic)).toBe(false);

    const minimax = minimaxAdapter.resolveReasoning(
      createRequest(minimaxAdapter, "MiniMax-M2.7"),
    );
    expect(minimax.capability.textExposure).toBe("raw");
    expect(minimax.callOptions).toMatchObject({
      providerOptions: {
        minimax: {
          thinking: {
            type: "enabled",
          },
          sendReasoning: true,
        },
      },
    });
    expect(minimax.callOptions?.providerOptions?.anthropic).toBeUndefined();
    expect(canPreviewCollapsedReasoningText(minimax)).toBe(true);
  });

  test("Zhipu exposes raw thinking without requiring replay", () => {
    const resolution = zhipuAdapter.resolveReasoning(
      createRequest(zhipuAdapter, "glm-5"),
    );

    expect(resolution.capability).toMatchObject({
      supported: true,
      textExposure: "raw",
      requiresReasoningReplay: "none",
    });
    expect(resolution.callOptions).toEqual({
      providerOptions: {
        zhipu: {
          thinking: { type: "enabled" },
        },
      },
    });
    expect(canPreviewCollapsedReasoningText(resolution)).toBe(true);
  });

  test("merges provider call options without dropping sibling provider settings", () => {
    expect(
      mergeAiSdkModelCallOptions(
        {
          providerOptions: {
            openai: { reasoningEffort: "low" },
            google: { safetySettings: "strict" },
          },
        },
        {
          providerOptions: {
            openai: { parallelToolCalls: false },
            anthropic: { thinking: { type: "enabled" } },
          },
        },
      ),
    ).toEqual({
      providerOptions: {
        openai: {
          reasoningEffort: "low",
          parallelToolCalls: false,
        },
        google: { safetySettings: "strict" },
        anthropic: { thinking: { type: "enabled" } },
      },
    });
  });
});
