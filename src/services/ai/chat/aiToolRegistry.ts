import type {
  AiChatToolDefinition,
  AiToolExecutionProgress,
  AiToolExecutionResult,
  AiToolName,
} from "./types";
import type { AiToolContext } from "./aiToolContext";
import { omitEmptyArrayFieldsDeep } from "@/services/ai/utils/json";
import { aiToolModules } from "./tools";
import {
  createErrorPayload,
  createToolHandlerMap,
  type AiToolHandler,
} from "./tools/shared";

export const createAiToolRegistry = (ctx: AiToolContext) => {
  const handlers = createToolHandlerMap(aiToolModules, ctx) satisfies Partial<
    Record<AiToolName, AiToolHandler>
  >;

  return {
    getDefinitions: (): AiChatToolDefinition[] =>
      Object.values(handlers)
        .filter((handler): handler is AiToolHandler => Boolean(handler))
        .map((handler) => handler.definition),
    execute: async (
      name: string,
      rawArgs: unknown,
      signal?: AbortSignal,
      onProgress?: (progress: AiToolExecutionProgress) => void,
    ) => {
      const handler = handlers[name as AiToolName];
      if (!handler) {
        return {
          payload: omitEmptyArrayFieldsDeep(
            createErrorPayload("UNKNOWN_TOOL", `Unknown tool: ${name}`),
          ),
          summary: `Unknown tool: ${name}`,
        } satisfies AiToolExecutionResult;
      }

      const result = await handler.execute(rawArgs, ctx, signal, onProgress);
      return {
        ...result,
        payload: omitEmptyArrayFieldsDeep(result.payload),
      } satisfies AiToolExecutionResult;
    },
  };
};
