import { initializeModelsDev } from "@/services/ai/providers/modelsDev";
beforeAll(() => initializeModelsDev());
import { beforeAll, describe, expect, test } from "vitest";

import { DEFAULT_EDITOR_UI_STATE } from "@/constants";
import { DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS } from "@/constants";
import {
  mergeModelCapabilitiesWithMetadata,
  resolveAiProviderModelReasoning,
  resolveAiProviderModelMetadata,
} from "@/services/ai/providers/metadata";
import { createOpenAiLikeModelCapabilities } from "@/services/ai/providers/capabilities";
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
  test("uses catalog model facts and reasoning controls", () => {
    expect(
      resolveAiProviderModelMetadata("openai", "gpt-4.1").contextWindowTokens,
    ).toBe(1_047_576);
    expect(
      resolveAiProviderModelMetadata("openai", "unknown-model")
        .contextWindowTokens,
    ).toBe(DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS);
    expect(
      resolveAiProviderModelMetadata("openai", "gpt-5-chat-latest").reasoning
        .supported,
    ).toBe(false);
    expect(
      resolveAiProviderModelReasoning("deepseek", "deepseek-flash").levels,
    ).toEqual(["none", "auto", "low", "high", "max"]);
    expect(
      resolveAiProviderModelReasoning("xiaomi-mimo", "mimo-v2.5-pro").levels,
    ).toEqual(["none", "auto"]);
    expect(
      resolveAiProviderModelMetadata("openai", "gpt-6.1-sol").reasoning.levels,
    ).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
    expect(
      mergeModelCapabilitiesWithMetadata(
        "anthropic",
        "claude-sonnet-4-6",
        createOpenAiLikeModelCapabilities({}),
      ),
    ).toMatchObject({
      supportsImageInput: true,
    });
  });

  test("DeepSeek enables thinking replay and validates assistant tool-call reasoning", () => {
    const resolution = deepseekAdapter.resolveReasoning(
      createRequest(deepseekAdapter, "deepseek-flash"),
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
          reasoningEffort: "high",
        },
      },
    });
    expect(canPreviewCollapsedReasoningText(resolution)).toBe(true);

    const auto = deepseekAdapter.resolveReasoning(
      createRequest(
        deepseekAdapter,
        "deepseek-flash",
        preference({ level: "auto" }),
      ),
    );
    expect(auto.callOptions).toEqual({
      providerOptions: {
        deepseek: {
          thinking: { type: "enabled" },
        },
      },
    });

    const max = deepseekAdapter.resolveReasoning(
      createRequest(
        deepseekAdapter,
        "deepseek-flash",
        preference({ level: "xhigh" }),
      ),
    );
    expect(max.callOptions).toEqual({
      providerOptions: {
        deepseek: {
          thinking: { type: "enabled" },
          reasoningEffort: "max",
        },
      },
    });

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
          forceReasoning: true,
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
          forceReasoning: true,
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
          forceReasoning: true,
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
            thinkingBudget: 8192,
          },
        },
      },
    });
    expect(visible.callOptions?.providerOptions?.google).not.toHaveProperty(
      "thinkingConfig.thinkingLevel",
    );
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

    const gemini3 = geminiAdapter.resolveReasoning(
      createRequest(geminiAdapter, "gemini-3.5-flash"),
    );
    expect(gemini3.callOptions).toMatchObject({
      providerOptions: {
        google: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: "high",
          },
        },
      },
    });
    expect(gemini3.callOptions?.providerOptions?.google).not.toHaveProperty(
      "thinkingConfig.thinkingBudget",
    );

    const gemini3Medium = geminiAdapter.resolveReasoning(
      createRequest(
        geminiAdapter,
        "gemini-3.5-flash",
        preference({ level: "medium" }),
      ),
    );
    expect(gemini3Medium.callOptions).toMatchObject({
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingLevel: "medium",
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
      createRequest(deepseekAdapter, "deepseek-flash", offPreference),
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

    const adaptiveAnthropic = anthropicAdapter.resolveReasoning(
      createRequest(
        anthropicAdapter,
        "claude-opus-4-7",
        preference({ level: "xhigh" }),
      ),
    );
    expect(adaptiveAnthropic.callOptions).toEqual({
      providerOptions: {
        anthropic: {
          thinking: {
            type: "adaptive",
            display: "summarized",
          },
          effort: "xhigh",
          sendReasoning: true,
        },
      },
    });
    expect(adaptiveAnthropic.replayPolicy).toBe("all");

    const minimax = minimaxAdapter.resolveReasoning(
      createRequest(minimaxAdapter, "MiniMax-M2.7"),
    );
    expect(minimax.capability.textExposure).toBe("raw");
    expect(minimax.callOptions).toMatchObject({
      providerOptions: {
        minimax: {
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
