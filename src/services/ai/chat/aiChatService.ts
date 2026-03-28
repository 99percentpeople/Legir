import {
  stepCountIs,
  streamText,
  type OnFinishEvent,
  type OnStepFinishEvent,
  type ToolSet,
} from "ai";

import { getAiChatSystemInstruction } from "@/services/ai/chat/prompts";
import {
  estimateAiChatMessageTokens,
  prepareAiChatMessagesForModelRuntime,
} from "@/services/ai/chat/runtime/messageContext";
import { createAiChatToolRuntime } from "@/services/ai/chat/runtime/toolRuntime";
import {
  AI_CHAT_MAX_TOOL_ROUNDS_MAX,
  AI_CHAT_MAX_TOOL_ROUNDS_MIN,
} from "@/constants";
import {
  resolveAiSdkLanguageModelDetailed,
  resolveAiSdkModelSpecifierForTask,
} from "@/services/ai/sdk";
import type { AppOptions, EditorState } from "@/types";
import type {
  AiChatAssistantUpdate,
  AiChatMessageRecord,
  AiChatTokenUsageSummary,
  AiChatToolUpdate,
  AiToolRegistry,
} from "./types";

type AiChatStreamFinishEvent = Pick<
  OnFinishEvent<ToolSet>,
  "finishReason" | "steps" | "totalUsage" | "response"
>;
type AiChatStreamFinishResolver = (result: AiChatStreamFinishEvent) => void;

const normalizeAiChatStreamError = (
  error: unknown,
  fallbackMessage: string,
): Error => {
  if (error instanceof Error) return error;
  if (typeof error === "string" && error.trim()) {
    return new Error(error.trim());
  }
  return new Error(fallbackMessage);
};

const toAiChatTokenUsageSummary = (
  usage:
    | OnFinishEvent<ToolSet>["totalUsage"]
    | OnStepFinishEvent<ToolSet>["usage"]
    | null
    | undefined,
): AiChatTokenUsageSummary => ({
  inputTokens: Math.max(0, Math.trunc(usage?.inputTokens ?? 0)),
  outputTokens: Math.max(0, Math.trunc(usage?.outputTokens ?? 0)),
  totalTokens: Math.max(0, Math.trunc(usage?.totalTokens ?? 0)),
  reasoningTokens: Math.max(
    0,
    Math.trunc(
      usage?.outputTokenDetails?.reasoningTokens ?? usage?.reasoningTokens ?? 0,
    ),
  ),
  cachedInputTokens: Math.max(
    0,
    Math.trunc(
      usage?.inputTokenDetails?.cacheReadTokens ??
        usage?.cachedInputTokens ??
        0,
    ),
  ),
});

const getAiChatContextTokens = (
  usage:
    | OnFinishEvent<ToolSet>["totalUsage"]
    | OnStepFinishEvent<ToolSet>["usage"]
    | null
    | undefined,
) => Math.max(0, Math.trunc(usage?.inputTokens ?? 0));

export const aiChatService = {
  async runConversation(options: {
    appOptions: AppOptions;
    modelCache: EditorState["llmModelCache"];
    messages: AiChatMessageRecord[];
    modelKey?: string;
    getContextMemory?: () =>
      | {
          text: string;
          coveredMessageCount: number;
          coveredTimelineItemCount: number;
          updatedAt: string;
        }
      | undefined;
    toolRegistry: AiToolRegistry;
    signal?: AbortSignal;
    onToolUpdate?: (update: AiChatToolUpdate) => void;
    onAssistantUpdate?: (update: AiChatAssistantUpdate) => void;
    onUsageUpdate?: (update: {
      tokenUsage: AiChatTokenUsageSummary;
      contextTokens: number;
      contextTokenOverhead: number;
      stepNumber: number;
    }) => void;
    maxToolRounds?: number;
  }) {
    const {
      appOptions,
      modelCache,
      modelKey,
      getContextMemory,
      toolRegistry,
      signal,
      onToolUpdate,
      onAssistantUpdate,
      onUsageUpdate,
      maxToolRounds = appOptions.aiChat.maxToolRounds,
    } = options;

    const baseConversation: AiChatMessageRecord[] = [...options.messages];
    const turnStartMessageCount = baseConversation.length;
    const buildStepMessages = async (messages: AiChatMessageRecord[]) =>
      await prepareAiChatMessagesForModelRuntime({
        messages,
        aiChatOptions: appOptions.aiChat,
        contextMemory: getContextMemory?.(),
        turnStartMessageCount,
      });
    const initialMessages = await buildStepMessages(baseConversation);
    let latestPreparedMessageTokenEstimate =
      estimateAiChatMessageTokens(initialMessages);
    const turnId = `ai_turn_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const maxToolSteps = Math.max(
      AI_CHAT_MAX_TOOL_ROUNDS_MIN,
      Math.min(AI_CHAT_MAX_TOOL_ROUNDS_MAX, Math.trunc(maxToolRounds || 0)),
    );
    const modelSpecifier = resolveAiSdkModelSpecifierForTask({
      appOptions,
      modelCache,
      kind: "chat",
      modelKey,
    });
    const resolvedModel = resolveAiSdkLanguageModelDetailed(
      appOptions,
      modelSpecifier,
      "chat",
    );
    const toolDefinitions = toolRegistry.getDefinitions();
    let currentBatchId = `${turnId}:step_0`;
    let stepIndex = 0;
    let assistantMessage = "";
    let reasoningText = "";
    let resolveFinishEvent: AiChatStreamFinishResolver | null = null;
    const finishEventPromise = new Promise<AiChatStreamFinishEvent>(
      (resolve) => {
        resolveFinishEvent = resolve;
      },
    );
    const toolRuntime = createAiChatToolRuntime({
      toolDefinitions,
      toolRegistry,
      signal,
      onToolUpdate,
      getCurrentBatchId: () => currentBatchId,
    });
    let latestResponseMessages: AiChatMessageRecord[] = [];

    try {
      const result = streamText({
        model: resolvedModel.model,
        ...(resolvedModel.callOptions ?? null),
        system: getAiChatSystemInstruction({
          toolDefinitions,
        }),
        messages: initialMessages,
        prepareStep: async ({ messages }) => {
          const preparedMessages = await buildStepMessages(messages);
          latestPreparedMessageTokenEstimate =
            estimateAiChatMessageTokens(preparedMessages);
          return {
            messages: preparedMessages,
          };
        },
        experimental_include: {
          requestBody: false,
        },
        tools: toolRuntime.tools,
        stopWhen: stepCountIs(maxToolSteps),
        onStepFinish: (step) => {
          latestResponseMessages = step.response.messages;
          const actualContextTokens = getAiChatContextTokens(step.usage);
          onUsageUpdate?.({
            tokenUsage: toAiChatTokenUsageSummary(step.usage),
            contextTokens: actualContextTokens,
            contextTokenOverhead: Math.max(
              0,
              actualContextTokens - latestPreparedMessageTokenEstimate,
            ),
            stepNumber: step.stepNumber,
          });
        },
        onFinish: ({ finishReason, steps, totalUsage, response }) => {
          resolveFinishEvent?.({
            finishReason,
            steps,
            totalUsage,
            response,
          });
          resolveFinishEvent = null;
        },
        abortSignal: signal,
      });

      for await (const part of result.fullStream) {
        if (part.type === "start-step") {
          stepIndex += 1;
          currentBatchId = `${turnId}:step_${stepIndex}`;
          continue;
        }

        if (part.type === "finish-step") {
          continue;
        }

        if (part.type === "reasoning-delta" && part.text) {
          reasoningText += part.text;
          onAssistantUpdate?.({
            phase: "reasoning_delta",
            turnId,
            delta: part.text,
          });
          continue;
        }

        if (part.type === "text-delta" && part.text) {
          assistantMessage += part.text;
          onAssistantUpdate?.({
            phase: "delta",
            turnId,
            delta: part.text,
          });
          continue;
        }

        if (part.type === "tool-error") {
          toolRuntime.handleStreamToolError({
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
            batchId: currentBatchId,
            error: part.error,
          });
          continue;
        }

        if (part.type === "abort") {
          const abortError = new Error(
            part.reason?.trim() || "AI chat request was aborted.",
          );
          abortError.name = "AbortError";
          throw abortError;
        }

        if (part.type === "error") {
          throw normalizeAiChatStreamError(
            part.error,
            "AI chat request failed.",
          );
        }
      }

      const [finalText, finishEvent] = await Promise.all([
        result.text,
        finishEventPromise,
      ]);
      const conversation: AiChatMessageRecord[] = [
        ...baseConversation,
        ...finishEvent.response.messages,
      ];
      if (!assistantMessage && finalText) {
        assistantMessage = finalText.trim();
      } else {
        assistantMessage = assistantMessage.trim();
      }

      const lastStep = finishEvent.steps.at(-1);
      const awaitingContinue =
        maxToolSteps > 0 &&
        finishEvent.steps.length >= maxToolSteps &&
        !!lastStep &&
        lastStep.toolResults.length > 0;

      const finalReasoningText = reasoningText.trim();
      onAssistantUpdate?.({
        phase: "end",
        turnId,
        reasoningText: finalReasoningText,
        assistantMessage,
        toolCalls: Array.from(toolRuntime.toolCallsById.values()),
        finishReason: assistantMessage ? "stop" : "tool_calls",
      });

      return {
        turnId,
        assistantMessage,
        conversation,
        awaitingContinue,
        tokenUsage: toAiChatTokenUsageSummary(finishEvent.totalUsage),
        contextTokens: getAiChatContextTokens(lastStep?.usage),
        contextTokenOverhead: Math.max(
          0,
          getAiChatContextTokens(lastStep?.usage) -
            latestPreparedMessageTokenEstimate,
        ),
      };
    } catch (error) {
      const normalized = normalizeAiChatStreamError(
        error,
        "AI chat request failed.",
      );
      const partialAssistantMessage = assistantMessage.trim();
      const carriedConversation = [
        ...baseConversation,
        ...latestResponseMessages,
        ...(partialAssistantMessage
          ? [
              {
                role: "assistant" as const,
                content: partialAssistantMessage,
              },
            ]
          : []),
      ];
      (
        normalized as Error & { conversation?: AiChatMessageRecord[] }
      ).conversation = carriedConversation;
      throw normalized;
    }
  },
};
