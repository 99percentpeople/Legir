import {
  runChatAgentTurn,
  runChatAgentTurnStream,
} from "@/services/LLMService";
import {
  normalizeAiToolArgsDeep,
  toSnakeCaseKeysDeep,
} from "@/services/aiChat/toolCase";
import type {
  LLMChatMessage,
  LLMChatToolCall,
  LLMChatToolDefinition,
  LLMChatTurnResult,
} from "@/services/LLMService/types";
import type { AiToolExecutionResult } from "./types";

const TOOL_RESULT_MAX_CHARS = 60_000;
const INTERNAL_SYSTEM_PREFIX = "INTERNAL:";

const truncateText = (value: string, maxChars: number) => {
  const text = String(value ?? "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 14))}…(truncated)`;
};

const stripInternalMessages = (messages: LLMChatMessage[]) => {
  return messages.filter((m) => {
    if (m.role !== "system") return true;
    const content = String(m.content ?? "").trimStart();
    return !content.startsWith(INTERNAL_SYSTEM_PREFIX);
  });
};

const stringifyToolArgs = (args: Record<string, unknown>) => {
  try {
    return JSON.stringify(normalizeAiToolArgsDeep(args ?? {}), null, 2);
  } catch {
    return "{}";
  }
};

const formatToolMessageContent = (options: {
  toolName: string;
  argsText: string;
  resultJson: string;
}) => {
  return [
    "TOOL_RESULT",
    `name: ${options.toolName}`,
    `arguments: ${options.argsText}`,
    `result: ${options.resultJson}`,
  ].join("\n");
};

const canRunToolCallsInParallel = (
  calls: LLMChatToolCall[],
  definitionsByName: Map<string, LLMChatToolDefinition>,
) => {
  return (
    calls.length > 1 &&
    calls.every(
      (call) => definitionsByName.get(call.name)?.accessType === "read",
    )
  );
};

type ToolRegistry = {
  getDefinitions: () => LLMChatToolDefinition[];
  execute: (
    name: string,
    rawArgs: unknown,
    signal?: AbortSignal,
  ) => Promise<AiToolExecutionResult>;
};

export type AiChatToolUpdate =
  | {
      phase: "start";
      call: LLMChatToolCall;
      batchId: string;
      isParallelBatch: boolean;
    }
  | {
      phase: "success";
      call: LLMChatToolCall;
      batchId: string;
      isParallelBatch: boolean;
      result: AiToolExecutionResult;
    }
  | {
      phase: "error";
      call: LLMChatToolCall;
      batchId: string;
      isParallelBatch: boolean;
      error: Error;
    };

export type AiChatAssistantUpdate =
  | { phase: "reasoning_delta"; turnId: string; delta: string }
  | { phase: "delta"; turnId: string; delta: string }
  | {
      phase: "end";
      turnId: string;
      reasoningText: string;
      assistantMessage: string;
      toolCalls: LLMChatToolCall[];
      finishReason: "stop" | "tool_calls";
    };

export const aiChatService = {
  async runConversation(options: {
    messages: LLMChatMessage[];
    providerId?: string;
    modelId?: string;
    toolRegistry: ToolRegistry;
    signal?: AbortSignal;
    onToolUpdate?: (update: AiChatToolUpdate) => void;
    onAssistantUpdate?: (update: AiChatAssistantUpdate) => void;
    maxToolRounds?: number;
  }) {
    const {
      providerId,
      modelId,
      toolRegistry,
      signal,
      onToolUpdate,
      onAssistantUpdate,
      maxToolRounds = 10,
    } = options;

    const conversation: LLMChatMessage[] = [...options.messages];
    let finalizeRequested = false;

    try {
      for (let round = 0; round < maxToolRounds; round += 1) {
        const turnId = `ai_turn_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        const toolDefinitions = toolRegistry.getDefinitions();
        const toolDefinitionsByName = new Map(
          toolDefinitions.map((definition) => [definition.name, definition]),
        );

        let turn: LLMChatTurnResult | null = null;

        for await (const event of runChatAgentTurnStream({
          providerId,
          modelId,
          messages: conversation,
          tools: toolDefinitions,
          signal,
        })) {
          if (event.type === "reasoning_delta") {
            onAssistantUpdate?.({
              phase: "reasoning_delta",
              turnId,
              delta: event.delta,
            });
            continue;
          }
          if (event.type === "assistant_delta") {
            onAssistantUpdate?.({
              phase: "delta",
              turnId,
              delta: event.delta,
            });
            continue;
          }
          turn = event.result;
        }

        if (!turn) {
          turn = await runChatAgentTurn({
            providerId,
            modelId,
            messages: conversation,
            tools: toolDefinitions,
            signal,
          });
        }

        const reasoningText = (turn.reasoningText || "").trim();
        const assistantMessage = (turn.assistantMessage || "").trim();
        if (assistantMessage) {
          conversation.push({
            role: "assistant",
            content: assistantMessage,
          });
        }

        onAssistantUpdate?.({
          phase: "end",
          turnId,
          reasoningText,
          assistantMessage,
          toolCalls: turn.toolCalls,
          finishReason: turn.finishReason,
        });

        if (turn.toolCalls.length === 0 || turn.finishReason === "stop") {
          // Some models may stop with an empty assistantMessage after tool usage.
          // Ask for a final answer once to avoid the UI looking "done" with no answer.
          if (!assistantMessage && !finalizeRequested) {
            finalizeRequested = true;
            conversation.push({
              role: "system",
              content:
                'INTERNAL: You must now provide the final answer to the user based on the tool results above. Do not call tools. Return JSON with tool_calls: [] and finish_reason: "stop". message must be non-empty.',
            });
            continue;
          }
          return {
            assistantMessage,
            conversation: stripInternalMessages(conversation),
          };
        }

        const isParallelBatch = canRunToolCallsInParallel(
          turn.toolCalls,
          toolDefinitionsByName,
        );

        for (const call of turn.toolCalls) {
          onToolUpdate?.({
            phase: "start",
            call,
            batchId: turnId,
            isParallelBatch,
          });
        }

        const executeCall = async (call: LLMChatToolCall) => {
          try {
            const result = await toolRegistry.execute(
              call.name,
              call.args,
              signal,
            );
            onToolUpdate?.({
              phase: "success",
              call,
              batchId: turnId,
              isParallelBatch,
              result,
            });
            return { call, ok: true as const, result };
          } catch (error) {
            const normalized =
              error instanceof Error ? error : new Error(String(error));
            onToolUpdate?.({
              phase: "error",
              call,
              batchId: turnId,
              isParallelBatch,
              error: normalized,
            });
            return { call, ok: false as const, error: normalized };
          }
        };

        const executedCalls = isParallelBatch
          ? await Promise.all(turn.toolCalls.map((call) => executeCall(call)))
          : await (async () => {
              const results: Array<
                | {
                    call: LLMChatToolCall;
                    ok: true;
                    result: AiToolExecutionResult;
                  }
                | {
                    call: LLMChatToolCall;
                    ok: false;
                    error: Error;
                  }
              > = [];
              for (const call of turn.toolCalls) {
                results.push(await executeCall(call));
              }
              return results;
            })();

        for (const executed of executedCalls) {
          const argsText = stringifyToolArgs(executed.call.args);
          if ("result" in executed) {
            const resultJson = truncateText(
              JSON.stringify(
                toSnakeCaseKeysDeep(executed.result.payload ?? null),
              ),
              TOOL_RESULT_MAX_CHARS,
            );
            conversation.push({
              role: "tool",
              content: formatToolMessageContent({
                toolName: executed.call.name,
                argsText,
                resultJson,
              }),
              toolCallId: executed.call.id,
              toolName: executed.call.name,
            });
            continue;
          }

          const resultJson = truncateText(
            JSON.stringify(
              toSnakeCaseKeysDeep({
                ok: false,
                error: executed.error.message,
              }),
            ),
            TOOL_RESULT_MAX_CHARS,
          );
          conversation.push({
            role: "tool",
            content: formatToolMessageContent({
              toolName: executed.call.name,
              argsText,
              resultJson,
            }),
            toolCallId: executed.call.id,
            toolName: executed.call.name,
          });
        }
      }

      throw new Error("The AI assistant exceeded the maximum tool rounds.");
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      // Expose best-effort state so callers can let the user "continue" with context.
      (normalized as Error & { conversation?: LLMChatMessage[] }).conversation =
        stripInternalMessages(conversation);
      throw normalized;
    }
  },
};
