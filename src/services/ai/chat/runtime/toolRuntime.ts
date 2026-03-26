import { tool, type ToolSet } from "ai";

import { omitEmptyArrayFieldsDeep } from "@/services/ai/utils/json";
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
  const normalizedPayload = omitEmptyArrayFieldsDeep(options.payload ?? null);
  const resultJson = truncateText(
    JSON.stringify(toSnakeCaseKeysDeep(normalizedPayload)),
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

const formatIssuePath = (path: unknown) =>
  Array.isArray(path)
    ? path
        .map((segment) =>
          typeof segment === "number" ? `[${segment}]` : String(segment),
        )
        .join(".")
    : "";

const formatStructuredIssues = (issues: unknown) => {
  if (!Array.isArray(issues)) return null;

  const formatted = issues
    .map((issue) => {
      if (!issue || typeof issue !== "object") return null;
      const path = formatIssuePath(
        (issue as { path?: unknown }).path as Array<string | number>,
      );
      const message = (issue as { message?: unknown }).message;
      if (typeof message !== "string" || !message.trim()) return null;
      return path ? `${path}: ${message}` : message;
    })
    .filter((message): message is string => Boolean(message));

  return formatted.length > 0 ? formatted.join("; ") : null;
};

const getObjectProperty = (value: unknown, key: string) =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined;

const extractToolErrorDetails = (
  error: unknown,
  toolName: string,
): { code: string; message: string } => {
  const name = getObjectProperty(error, "name");
  const message = getObjectProperty(error, "message");
  const cause = getObjectProperty(error, "cause");
  const directIssues = formatStructuredIssues(
    getObjectProperty(error, "issues"),
  );
  const causeIssues = formatStructuredIssues(
    getObjectProperty(cause, "issues"),
  );
  const detailedMessage =
    directIssues ||
    causeIssues ||
    (typeof message === "string" && message.trim() ? message : null) ||
    (typeof getObjectProperty(cause, "message") === "string"
      ? (getObjectProperty(cause, "message") as string)
      : null) ||
    `Tool call failed: ${toolName}`;
  const isValidationError =
    name === "AI_TypeValidationError" ||
    name === "TypeValidationError" ||
    name === "ZodError" ||
    !!directIssues ||
    !!causeIssues;

  return {
    code: isValidationError ? "INVALID_ARGUMENTS" : "TOOL_CALL_FAILED",
    message: detailedMessage,
  };
};

const normalizeToolError = (error: unknown, toolName: string) => {
  const details = extractToolErrorDetails(error, toolName);
  const normalized = new Error(details.message);
  normalized.name = details.code;
  return {
    error: normalized,
    payload: {
      ok: false,
      error: details.code,
      message: details.message,
    },
  };
};

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

  const tools: ToolSet = {};

  for (const definition of toolDefinitions) {
    tools[definition.name] = tool({
      description: definition.description,
      inputSchema: definition.inputSchema,
      ...(definition.toModelOutput
        ? { toModelOutput: definition.toModelOutput }
        : {}),
      execute: async (input, executeOptions) => {
        const call: AiChatToolCallRecord = {
          id: executeOptions.toolCallId,
          name: definition.name,
          args: toToolArgsRecord(input),
        };
        const batchId = options.getCurrentBatchId();
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

            return result.modelOutput ?? result.payload;
          } catch (error) {
            const normalized = normalizeToolError(error, definition.name);

            conversation.push(
              createToolConversationMessage({
                callId: call.id,
                toolName: definition.name,
                args: call.args,
                payload: normalized.payload,
              }),
            );

            notifyToolError({
              call,
              batchId,
              error: normalized.error,
            });

            throw normalized.error;
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
    tools,
    toolCallsById,
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
      toolCallsById.set(call.id, call);
      const normalized = normalizeToolError(error, toolName);
      notifyToolStart(call, batchId);
      conversation.push(
        createToolConversationMessage({
          callId: call.id,
          toolName,
          args: call.args,
          payload: normalized.payload,
        }),
      );
      notifyToolError({
        call,
        batchId,
        error: normalized.error,
      });
    },
  };
};
