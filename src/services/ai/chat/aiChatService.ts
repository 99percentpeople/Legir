import { generateText, stepCountIs, streamText } from "ai";

import {
  buildAiChatTurnPrompt,
  getAiChatSystemInstruction,
} from "@/services/ai/chat/prompts";
import { createAiChatToolRuntime } from "@/services/ai/chat/runtime/toolRuntime";
import {
  resolveAiSdkLanguageModel,
  resolveAiSdkModelSpecifierForTask,
} from "@/services/ai/sdk";
import type { AppOptions, EditorState } from "@/types";
import type {
  AiChatAssistantUpdate,
  AiChatMessageRecord,
  AiChatToolUpdate,
  AiToolRegistry,
} from "./types";

const createFinalAnswerPrompt = (messages: AiChatMessageRecord[]) =>
  [
    buildAiChatTurnPrompt({ messages }),
    "",
    "Provide the final answer to the user now.",
    "Do not call any tools.",
    "Reply in the same language as the user's most recent message.",
    "Use plain natural language.",
  ].join("\n");

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
    const modelSpecifier = resolveAiSdkModelSpecifierForTask({
      appOptions,
      modelCache,
      kind: "chat",
      modelKey,
    });
    const model = resolveAiSdkLanguageModel(appOptions, modelSpecifier);
    const toolDefinitions = toolRegistry.getDefinitions();
    const hasDocumentDigestTool = toolDefinitions.some(
      (definition) => definition.name === "get_document_digest",
    );
    let currentBatchId = `${turnId}:step_0`;
    let stepIndex = 0;
    let toolRoundCount = 0;
    let assistantMessage = "";
    let reasoningText = "";
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
        model,
        system: getAiChatSystemInstruction({
          hasDocumentDigestTool,
        }),
        prompt: buildAiChatTurnPrompt({
          messages: conversation,
        }),
        tools: toolRuntime.aiTools,
        stopWhen: stepCountIs(maxToolRounds + 1),
        abortSignal: signal,
      });

      for await (const part of result.fullStream) {
        if (part.type === "start-step") {
          stepIndex += 1;
          currentBatchId = `${turnId}:step_${stepIndex}`;
          continue;
        }

        if (part.type === "finish-step") {
          if (part.finishReason === "tool-calls") {
            toolRoundCount += 1;
          }
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

      const [finalText, steps] = await Promise.all([result.text, result.steps]);
      if (!assistantMessage && finalText) {
        assistantMessage = finalText.trim();
      } else {
        assistantMessage = assistantMessage.trim();
      }

      if (!assistantMessage && toolRuntime.sawToolActivity()) {
        const finalAnswer = await generateText({
          model,
          system: getAiChatSystemInstruction({
            hasDocumentDigestTool,
          }),
          prompt: createFinalAnswerPrompt(conversation),
          abortSignal: signal,
        });
        assistantMessage = finalAnswer.text.trim();
        if (!reasoningText && finalAnswer.reasoningText) {
          reasoningText = finalAnswer.reasoningText.trim();
        }
      }

      const lastStep = steps.at(-1);
      if (
        toolRoundCount >= maxToolRounds &&
        lastStep &&
        lastStep.toolResults.length > 0 &&
        !assistantMessage
      ) {
        throw new Error("The AI assistant exceeded the maximum tool rounds.");
      }

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
