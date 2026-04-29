import { describe, expect, test } from "vitest";

import { DEFAULT_EDITOR_UI_STATE } from "@/constants";
import { anthropicRuntimeProfile } from "@/services/ai/providers/runtimeProfiles/anthropic";
import { deepseekRuntimeProfile } from "@/services/ai/providers/runtimeProfiles/deepseek";
import { geminiRuntimeProfile } from "@/services/ai/providers/runtimeProfiles/gemini";
import { minimaxAnthropicRuntimeProfile } from "@/services/ai/providers/runtimeProfiles/minimax";
import { openAiRuntimeProfile } from "@/services/ai/providers/runtimeProfiles/openai";
import {
  canDisplayReasoningText,
  canPreviewCollapsedReasoningText,
  mergeAiSdkModelCallOptions,
  normalizeReasoningPreference,
} from "@/services/ai/providers/runtimeProfiles/shared";
import type {
  AiProviderRuntimeProfile,
  AiProviderRuntimeRequest,
  AiReasoningPreference,
} from "@/services/ai/providers/runtimeProfiles/types";

const preference = (value?: Partial<AiReasoningPreference>) =>
  normalizeReasoningPreference({
    mode: "on",
    effort: "high",
    displayPolicy: "summary",
    ...value,
  });

const createRequest = (
  profile: AiProviderRuntimeProfile,
  modelId: string,
  pref = preference(),
) =>
  ({
    providerId: profile.providerId,
    backendKind:
      profile.providerId === "gemini"
        ? "google"
        : profile.providerId === "minimax"
          ? "minimax-anthropic"
          : profile.providerId,
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
  }) as AiProviderRuntimeRequest & { preference: AiReasoningPreference };

describe("AI provider runtime profiles", () => {
  test("DeepSeek enables thinking replay and validates assistant tool-call reasoning", () => {
    const resolution = deepseekRuntimeProfile.resolveReasoning(
      createRequest(deepseekRuntimeProfile, "deepseek-reasoner"),
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
      deepseekRuntimeProfile.validateMessages?.(
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
          NonNullable<typeof deepseekRuntimeProfile.validateMessages>
        >[1],
      ),
    ).toThrow(/requires reasoning content/);

    expect(() =>
      deepseekRuntimeProfile.validateMessages?.(
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
          NonNullable<typeof deepseekRuntimeProfile.validateMessages>
        >[1],
      ),
    ).not.toThrow();
  });

  test("OpenAI reasoning models hide non-exposed reasoning text", () => {
    const resolution = openAiRuntimeProfile.resolveReasoning(
      createRequest(openAiRuntimeProfile, "gpt-5.4-mini"),
    );

    expect(resolution.effectivePreference).toMatchObject({
      mode: "on",
      effort: "high",
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
  });

  test("Gemini exposes summary reasoning and respects hidden display preference", () => {
    const visible = geminiRuntimeProfile.resolveReasoning(
      createRequest(geminiRuntimeProfile, "gemini-2.5-flash"),
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

    const hidden = geminiRuntimeProfile.resolveReasoning(
      createRequest(
        geminiRuntimeProfile,
        "gemini-2.5-flash",
        preference({ displayPolicy: "hidden", budgetTokens: 2048 }),
      ),
    );
    expect(hidden.callOptions).toMatchObject({
      providerOptions: {
        google: {
          thinkingConfig: {
            includeThoughts: false,
            thinkingBudget: 2048,
          },
        },
      },
    });
  });

  test("Anthropic summaries do not preview while MiniMax raw reasoning can preview", () => {
    const anthropic = anthropicRuntimeProfile.resolveReasoning(
      createRequest(anthropicRuntimeProfile, "claude-sonnet-4-6"),
    );
    expect(anthropic.replayPolicy).toBe("all");
    expect(anthropic.capability.textExposure).toBe("summary");
    expect(canDisplayReasoningText(anthropic)).toBe(true);
    expect(canPreviewCollapsedReasoningText(anthropic)).toBe(false);

    const minimax = minimaxAnthropicRuntimeProfile.resolveReasoning(
      createRequest(minimaxAnthropicRuntimeProfile, "MiniMax-M2.7"),
    );
    expect(minimax.capability.textExposure).toBe("raw");
    expect(canPreviewCollapsedReasoningText(minimax)).toBe(true);
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
