import { stepCountIs, streamText, type OnFinishEvent, type ToolSet } from "ai";

import {
  buildAiChatTurnPrompt,
  getAiChatSystemInstruction,
} from "@/services/ai/chat/prompts";
import { createAiChatToolRuntime } from "@/services/ai/chat/runtime/toolRuntime";
import {
  resolveAiSdkLanguageModelDetailed,
  resolveAiSdkModelSpecifierForTask,
} from "@/services/ai/sdk";
import type { AppOptions, EditorState } from "@/types";
import type {
  AiChatAssistantUpdate,
  AiChatMessageRecord,
  AiChatToolUpdate,
  AiToolRegistry,
} from "./types";

type AiChatStreamFinishEvent = Pick<
  OnFinishEvent<ToolSet>,
  "finishReason" | "steps"
>;
type AiChatStreamFinishResolver = (result: AiChatStreamFinishEvent) => void;

export const aiChatService = {
  async runConversation(options: {
    appOptions: AppOptions;
    modelCache: EditorState["llmModelCache"];
    messages: AiChatMessageRecord[];
    modelKey?: string;
    toolRegistry: AiToolRegistry;
    signal?: AbortSignal;
    onToolUpdate?: (update: AiChatToolUpdate) => void;
    onAssistantUpdate?: (update: AiChatAssistantUpdate) => void;
    maxToolRounds?: number;
  }) {
    const {
      appOptions,
      modelCache,
      modelKey,
      toolRegistry,
      signal,
      onToolUpdate,
      onAssistantUpdate,
      maxToolRounds = 10,
    } = options;

    const conversation: AiChatMessageRecord[] = [...options.messages];
    const turnId = `ai_turn_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const maxToolSteps = Math.max(0, Math.trunc(maxToolRounds));
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
      conversation,
      signal,
      onToolUpdate,
      getCurrentBatchId: () => currentBatchId,
    });

    try {
      const result = streamText({
        model: resolvedModel.model,
        ...(resolvedModel.callOptions ?? null),
        system: getAiChatSystemInstruction({ toolDefinitions }),
        prompt: buildAiChatTurnPrompt({
          messages: conversation,
        }),
        experimental_include: {
          requestBody: false,
        },
        tools: toolRuntime.tools,
        stopWhen: stepCountIs(maxToolSteps),
        onFinish: ({ finishReason, steps }) => {
          resolveFinishEvent?.({
            finishReason,
            steps,
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
        }
      }

      const [finalText, finishEvent] = await Promise.all([
        result.text,
        finishEventPromise,
      ]);
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
      if (assistantMessage) {
        conversation.push({
          role: "assistant",
          content: assistantMessage,
        });
      }

      onAssistantUpdate?.({
        phase: "end",
        turnId,
        reasoningText: finalReasoningText,
        assistantMessage,
        toolCalls: Array.from(toolRuntime.toolCallsById.values()),
        finishReason: assistantMessage ? "stop" : "tool_calls",
      });

      return {
        assistantMessage,
        conversation,
        awaitingContinue,
      };
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      (
        normalized as Error & { conversation?: AiChatMessageRecord[] }
      ).conversation = conversation;
      throw normalized;
    }
  },
};
