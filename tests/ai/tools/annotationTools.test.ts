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
  supportsImageToolResults: false,
  contextWindowTokens: 128_000,
  ...overrides,
});

describe("AI chat annotation tools", () => {
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
