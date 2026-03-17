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
import { getConfiguredAiSdkProvider } from "@/services/ai/sdk/providers";
import type { AiSdkProviderId } from "@/services/ai/sdk/types";
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
    "Provide the final user-facing answer now.",
    "Do not call any tools.",
    "Reply in the same language as the user's most recent message.",
    "Lead with the answer or next useful action.",
    "Use light markdown when it improves readability.",
    'If you include an internal document link, use a correct clickable format such as [text](/document/page/3) or <a href="/document/page/3">text</a>, never a bare /document/... path.',
    "If exact page numbers, control_ids, or result_ids already exist in the conversation, keep any helpful document links in the answer.",
    "Offer one concrete follow-up suggestion or question only when it adds value.",
  ].join("\n");

const buildChatProviderOptions = (options: {
  appOptions: AppOptions;
  providerId: AiSdkProviderId;
}) => {
  const provider = getConfiguredAiSdkProvider(
    options.appOptions,
    options.providerId,
  );

  if (!provider) {
    return undefined;
  }

  if (provider.backendKind === "openai") {
    return {
      openai: {
        parallelToolCalls: true,
      },
    } as const;
  }

  if (provider.backendKind === "openai-compatible") {
    return {
      [provider.providerId]: {
        parallel_tool_calls: true,
      },
    };
  }

  return undefined;
};

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
    const providerOptions = buildChatProviderOptions({
      appOptions,
      providerId: modelSpecifier.providerId,
    });
    const toolDefinitions = toolRegistry.getDefinitions();
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
        system: getAiChatSystemInstruction({ toolDefinitions }),
        prompt: buildAiChatTurnPrompt({
          messages: conversation,
        }),
        ...(providerOptions ? { providerOptions } : null),
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
          system: getAiChatSystemInstruction({ toolDefinitions }),
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
