import { describe, expect, test } from "vitest";

import type { AiToolContext } from "@/services/ai/chat/aiToolContext";
import { createAiToolRegistry } from "@/services/ai/chat/aiToolRegistry";
import type { LLMModelCapabilities } from "@/types";

const createCapabilities = (
  overrides: Partial<LLMModelCapabilities> = {},
): LLMModelCapabilities => ({
  inputModalities: ["text"],
  outputModalities: ["text"],
  supportsImageInput: false,
  supportsToolCalls: true,
  contextWindowTokens: 128_000,
  ...overrides,
});

describe("AI chat annotation tools", () => {
  test("publishes only the unified editing/navigation tools", () => {
    const registry = createAiToolRegistry({
      formToolsEnabled: true,
      canAttachPageVisuals: () => true,
    } as unknown as AiToolContext);
    const names = registry.getDefinitions().map((tool) => tool.name);
    expect(names).toHaveLength(19); // Workspace adds list_open_documents.
    expect(names).toContain("update_annotations");
    expect(names).toContain("navigate");
    for (const removed of [
      "update_annotation_texts",
      "update_highlight_annotations",
      "update_freetext_annotations",
      "update_shape_annotations",
      "navigate_page",
      "focus_control",
      "focus_result",
    ]) {
      expect(names).not.toContain(removed);
    }
  });

  test("exposes annotation creation tools to text-only models", () => {
    const registry = createAiToolRegistry({} as AiToolContext, {
      modelCapabilities: createCapabilities(),
    });
    const toolNames = registry
      .getDefinitions()
      .map((definition) => definition.name);

    expect(toolNames).toContain("create_freetext_annotations");
    expect(toolNames).toContain("create_shape_annotations");
    expect(toolNames).not.toContain("inspect_pages_visual");
  });
});
