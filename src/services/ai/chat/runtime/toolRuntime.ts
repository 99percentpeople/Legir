import { tool, type ToolSet } from "ai";

import {
  normalizeAiToolArgsDeep,
  toSnakeCaseKeysDeep,
} from "@/services/ai/utils/toolCase";
import type {
  AiChatMessageRecord,
  AiChatToolCallRecord,
  AiChatToolDefinition,
  AiChatToolRuntime,
  AiChatToolUpdate,
  AiToolRegistry,
} from "@/services/ai/chat/types";

const TOOL_RESULT_MAX_CHARS = 60_000;

const truncateText = (value: string, maxChars: number) => {
  const text = String(value ?? "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 14))}…(truncated)`;
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

const createToolConversationMessage = (options: {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  payload: unknown;
}): AiChatMessageRecord => {
  const argsText = stringifyToolArgs(options.args);
  const resultJson = truncateText(
    JSON.stringify(toSnakeCaseKeysDeep(options.payload ?? null)),
    TOOL_RESULT_MAX_CHARS,
  );

  return {
    role: "tool",
    content: formatToolMessageContent({
      toolName: options.toolName,
      argsText,
      resultJson,
    }),
    toolCallId: options.callId,
    toolName: options.toolName,
  };
};

const toToolArgsRecord = (input: unknown) =>
  input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};

export const createAiChatToolRuntime = (options: {
  toolDefinitions: AiChatToolDefinition[];
  toolRegistry: AiToolRegistry;
  conversation: AiChatMessageRecord[];
  signal?: AbortSignal;
  onToolUpdate?: (update: AiChatToolUpdate) => void;
  getCurrentBatchId: () => string;
}): AiChatToolRuntime => {
  const { toolDefinitions, toolRegistry, conversation, signal, onToolUpdate } =
    options;

  const definitionsByName = new Map<string, AiChatToolDefinition>(
    toolDefinitions.map((definition) => [definition.name, definition]),
  );
  const startedToolCalls = new Set<string>();
  const toolCallsById = new Map<string, AiChatToolCallRecord>();
  let writeQueue: Promise<void> = Promise.resolve();
  let sawToolActivity = false;

  const notifyToolStart = (call: AiChatToolCallRecord, batchId: string) => {
    if (startedToolCalls.has(call.id)) return;
    startedToolCalls.add(call.id);
    onToolUpdate?.({
      phase: "start",
      call,
      batchId,
      isParallelBatch: definitionsByName.get(call.name)?.accessType === "read",
    });
  };

  const notifyToolError = (options: {
    call: AiChatToolCallRecord;
    batchId: string;
    error: Error;
  }) => {
    onToolUpdate?.({
      phase: "error",
      call: options.call,
      batchId: options.batchId,
      isParallelBatch:
        definitionsByName.get(options.call.name)?.accessType === "read",
      error: options.error,
    });
  };

  const aiTools: ToolSet = {};

  for (const definition of toolDefinitions) {
    aiTools[definition.name] = tool({
      description: definition.description,
      inputSchema: definition.inputSchema,
      execute: async (input, executeOptions) => {
        const call: AiChatToolCallRecord = {
          id: executeOptions.toolCallId,
          name: definition.name,
          args: toToolArgsRecord(input),
        };
        const batchId = options.getCurrentBatchId();

        sawToolActivity = true;
        toolCallsById.set(call.id, call);
        notifyToolStart(call, batchId);

        const runExecution = async () => {
          try {
            const result = await toolRegistry.execute(
              definition.name,
              call.args,
              executeOptions.abortSignal ?? signal,
              (progress) => {
                onToolUpdate?.({
                  phase: "progress",
                  call,
                  batchId,
                  isParallelBatch: definition.accessType === "read",
                  progress,
                });
              },
            );

            conversation.push(
              createToolConversationMessage({
                callId: call.id,
                toolName: definition.name,
                args: call.args,
                payload: result.payload,
              }),
            );

            onToolUpdate?.({
              phase: "success",
              call,
              batchId,
              isParallelBatch: definition.accessType === "read",
              result,
            });

            return result.payload;
          } catch (error) {
            const normalized =
              error instanceof Error ? error : new Error(String(error));

            conversation.push(
              createToolConversationMessage({
                callId: call.id,
                toolName: definition.name,
                args: call.args,
                payload: {
                  ok: false,
                  error: normalized.message,
                },
              }),
            );

            notifyToolError({
              call,
              batchId,
              error: normalized,
            });

            throw normalized;
          }
        };

        if (definition.accessType === "write") {
          const executeAfterWrites = writeQueue.then(
            runExecution,
            runExecution,
          );
          writeQueue = executeAfterWrites.then(
            () => undefined,
            () => undefined,
          );
          return await executeAfterWrites;
        }

        return await runExecution();
      },
    });
  }

  return {
    aiTools,
    toolCallsById,
    sawToolActivity: () => sawToolActivity,
    handleStreamToolError: ({
      toolCallId,
      toolName,
      input,
      batchId,
      error,
    }) => {
      const call: AiChatToolCallRecord = {
        id: toolCallId,
        name: toolName,
        args: toToolArgsRecord(input),
      };
      notifyToolStart(call, batchId);
      notifyToolError({
        call,
        batchId,
        error:
          error instanceof Error
            ? error
            : new Error(`Tool call failed: ${toolName}`),
      });
    },
  };
};
