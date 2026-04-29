import { describe, expect, test } from "vitest";
import { z } from "zod";

import { createAiChatToolRuntime } from "@/services/ai/chat/runtime/toolRuntime";
import type {
  AiChatToolDefinition,
  AiChatToolRuntime,
  AiChatToolUpdate,
  AiToolRegistry,
} from "@/services/ai/chat/types";

type ExecutableAiTool = {
  execute: (
    input: unknown,
    options: { toolCallId: string; abortSignal?: AbortSignal },
  ) => Promise<unknown>;
};

const createDefinition = (
  name: AiChatToolDefinition["name"],
  accessType: AiChatToolDefinition["accessType"],
): AiChatToolDefinition => ({
  name,
  accessType,
  description: `${name} description`,
  inputSchema: z.object({
    value: z.number().optional(),
  }),
});

const getExecutableTool = (runtime: AiChatToolRuntime, name: string) =>
  runtime.tools[name] as unknown as ExecutableAiTool;

describe("AI chat tool runtime", () => {
  test("emits start, progress, and success updates for executed tools", async () => {
    const updates: AiChatToolUpdate[] = [];
    const registry: AiToolRegistry = {
      getDefinitions: () => [],
      execute: async (_name, rawArgs, _signal, onProgress) => {
        onProgress?.({
          summary: "Working",
          details: ["step 1"],
        });
        return {
          payload: { ok: true, rawArgs },
          summary: "Done",
          modelOutput: { type: "text", text: "model output" },
        };
      },
    };
    const runtime = createAiChatToolRuntime({
      toolDefinitions: [createDefinition("get_pages_text", "read")],
      toolRegistry: registry,
      getCurrentBatchId: () => "turn_1:step_1",
      onToolUpdate: (update) => updates.push(update),
    });

    const result = await getExecutableTool(runtime, "get_pages_text").execute(
      { value: 1 },
      { toolCallId: "call_1" },
    );

    expect(result).toEqual({ type: "text", text: "model output" });
    expect(runtime.toolCallsById.get("call_1")).toEqual({
      id: "call_1",
      name: "get_pages_text",
      args: { value: 1 },
    });
    expect(updates.map((update) => update.phase)).toEqual([
      "start",
      "progress",
      "success",
    ]);
    expect(updates[0]).toMatchObject({
      batchId: "turn_1:step_1",
      isParallelBatch: true,
      call: { id: "call_1", name: "get_pages_text" },
    });
  });

  test("serializes write tool executions", async () => {
    const order: string[] = [];
    let releaseFirst = () => {};
    const firstBarrier = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const registry: AiToolRegistry = {
      getDefinitions: () => [],
      execute: async (_name, rawArgs) => {
        const value =
          rawArgs && typeof rawArgs === "object"
            ? (rawArgs as { value?: unknown }).value
            : undefined;
        order.push(`start:${String(value)}`);
        if (value === 1) {
          await firstBarrier;
        }
        order.push(`end:${String(value)}`);
        return {
          payload: { value },
          summary: `done ${String(value)}`,
        };
      },
    };
    const runtime = createAiChatToolRuntime({
      toolDefinitions: [createDefinition("fill_form_fields", "write")],
      toolRegistry: registry,
      getCurrentBatchId: () => "turn_1:step_1",
    });
    const tool = getExecutableTool(runtime, "fill_form_fields");

    const first = tool.execute({ value: 1 }, { toolCallId: "call_1" });
    const second = tool.execute({ value: 2 }, { toolCallId: "call_2" });

    await Promise.resolve();
    expect(order).toEqual(["start:1"]);
    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(["start:1", "end:1", "start:2", "end:2"]);
  });

  test("normalizes stream tool validation errors into start and error updates", () => {
    const updates: AiChatToolUpdate[] = [];
    const runtime = createAiChatToolRuntime({
      toolDefinitions: [createDefinition("get_pages_text", "read")],
      toolRegistry: {
        getDefinitions: () => [],
        execute: async () => ({ payload: {}, summary: "" }),
      },
      getCurrentBatchId: () => "turn_1:step_1",
      onToolUpdate: (update) => updates.push(update),
    });

    runtime.handleStreamToolError({
      toolCallId: "call_1",
      toolName: "get_pages_text",
      input: { pageNumbers: [] },
      batchId: "turn_1:step_1",
      error: {
        name: "AI_TypeValidationError",
        issues: [{ path: ["page_numbers"], message: "Required" }],
      },
    });

    expect(updates.map((update) => update.phase)).toEqual(["start", "error"]);
    const errorUpdate = updates[1];
    expect(errorUpdate?.phase).toBe("error");
    if (errorUpdate?.phase !== "error") return;
    expect(errorUpdate.error.name).toBe("INVALID_ARGUMENTS");
    expect(errorUpdate.error.message).toBe("page_numbers: Required");
  });
});
