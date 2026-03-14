import { zodToJsonSchema } from "zod-to-json-schema";
import { toSnakeCaseKeysDeep } from "@/services/aiChat/toolCase";

import type { LLMChatToolDefinition } from "./types";

const jsonSchemaCache = new WeakMap<object, Record<string, unknown>>();

export const getToolInputJsonSchema = (
  inputSchema: LLMChatToolDefinition["inputSchema"],
) => {
  const cached = jsonSchemaCache.get(inputSchema);
  if (cached) return cached;

  const raw = zodToJsonSchema(inputSchema, {
    $refStrategy: "none",
  }) as Record<string, unknown>;
  const normalized = Object.fromEntries(
    Object.entries(raw).filter(([key]) => key !== "$schema"),
  );

  jsonSchemaCache.set(inputSchema, normalized);
  return normalized;
};

export const serializeToolDefinitions = (tools: LLMChatToolDefinition[]) =>
  tools.map((tool) => ({
    ...toSnakeCaseKeysDeep(tool),
    input_schema: getToolInputJsonSchema(tool.inputSchema),
  }));
