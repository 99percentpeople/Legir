import type {
  AiChatToolDefinition,
  AiToolRegistryOptions,
  AiToolExecutionProgress,
  AiToolExecutionResult,
  AiToolName,
} from "./types";
import type { AiToolContext } from "./aiToolContext";
import { omitEmptyArrayFieldsDeep } from "@/services/ai/utils/json";
import { modelSupportsInputModality } from "@/services/ai/providers/modelCapabilities";
import { aiToolModules } from "./tools";
import {
  createErrorPayload,
  createToolHandlerMap,
  type AiToolHandler,
} from "./tools/shared";

const supportsToolDefinition = (
  definition: AiChatToolDefinition,
  options: AiToolRegistryOptions | undefined,
) => {
  const requiredInputModalities = definition.requiredInputModalities ?? [];
  if (requiredInputModalities.length === 0) return true;

  return requiredInputModalities.every((modality) =>
    modelSupportsInputModality(options?.modelCapabilities, modality),
  );
};

export const createAiToolRegistry = (
  ctx: AiToolContext,
  options?: AiToolRegistryOptions,
) => {
  const handlers = createToolHandlerMap(aiToolModules, ctx) satisfies Partial<
    Record<AiToolName, AiToolHandler>
  >;
  const filteredHandlers = Object.fromEntries(
    Object.entries(handlers).filter(
      (entry): entry is [AiToolName, AiToolHandler] => {
        const handler = entry[1];
        return Boolean(
          handler && supportsToolDefinition(handler.definition, options),
        );
      },
    ),
  ) satisfies Partial<Record<AiToolName, AiToolHandler>>;

  return {
    getDefinitions: (): AiChatToolDefinition[] =>
      Object.values(filteredHandlers)
        .filter((handler): handler is AiToolHandler => Boolean(handler))
        .map((handler) => handler.definition),
    execute: async (
      name: string,
      rawArgs: unknown,
      signal?: AbortSignal,
      onProgress?: (progress: AiToolExecutionProgress) => void,
    ) => {
      const handler = filteredHandlers[name as AiToolName];
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
