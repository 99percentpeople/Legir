import type {
  AiChatToolDefinition,
  AiToolExecutionContext,
  AiToolExecutionProgress,
  AiToolExecutionResult,
  AiToolName,
} from "./types";
import { createAnnotationToolHandlers } from "./tools/annotationTools";
import { createDocumentToolHandlers } from "./tools/documentTools";
import { createFormToolHandlers } from "./tools/formTools";
import { createNavigationToolHandlers } from "./tools/navigationTools";
import { createErrorPayload, type AiToolHandler } from "./tools/shared";

export const createAiToolRegistry = (ctx: AiToolExecutionContext) => {
  const handlers = {
    ...createDocumentToolHandlers(ctx),
    ...createAnnotationToolHandlers(ctx),
    ...createFormToolHandlers(ctx),
    ...createNavigationToolHandlers(ctx),
  } satisfies Partial<Record<AiToolName, AiToolHandler>>;

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
          payload: createErrorPayload("UNKNOWN_TOOL", `Unknown tool: ${name}`),
          summary: `Unknown tool: ${name}`,
        } satisfies AiToolExecutionResult;
      }

      return await handler.execute(rawArgs, ctx, signal, onProgress);
    },
  };
};
