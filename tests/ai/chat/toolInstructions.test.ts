import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { DEFAULT_EDITOR_UI_STATE } from "@/constants";
import { aiChatService } from "@/services/ai/chat/aiChatService";
import { createAiToolRegistry } from "@/services/ai/chat/aiToolRegistry";
import type { AiToolContext } from "@/services/ai/chat/aiToolContext";
import { createWorkspaceAiToolRegistry } from "@/services/ai/chat/workspaceToolRegistry";
import type { AiWorkspace } from "@/services/ai/chat/workspace";
import { createAiConnection } from "@/services/ai/providers/connections";
import { initializeModelsDev } from "@/services/ai/providers/modelsDev";
import { AI_PAGE_COORDINATE_CONVENTION } from "@/services/ai/utils/pageCoordinates";

beforeAll(() => initializeModelsDev());
afterEach(() => vi.unstubAllGlobals());

describe("tool instructions in actual SDK requests", () => {
  test.each([true, false])(
    "sends only enabled rules once, with optional visual/form tools enabled=%s",
    async (enabled) => {
      const registry = createAiToolRegistry({
        formToolsEnabled: enabled,
        canAttachPageVisuals: () => enabled,
      } as AiToolContext);
      const workspaceRegistry = createWorkspaceAiToolRegistry({
        workspace: {
          getDocumentLinkId: () => "d_test12345678",
        } as unknown as AiWorkspace,
        defaultDocumentId: "t_test12345678",
        definitions: registry.getDefinitions(),
        createRegistry: () => registry,
      });
      const requests: {
        messages: { role: string; content: string }[];
        tools: { function: { name: string } }[];
      }[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          requests.push(JSON.parse(String(init.body)));
          return new Response(
            [
              {
                delta: { role: "assistant", content: "Ready." },
                finish_reason: null,
              },
              { delta: {}, finish_reason: "stop" },
            ]
              .map(
                (choice) =>
                  `data: ${JSON.stringify({
                    id: "reply",
                    object: "chat.completion.chunk",
                    created: 1,
                    model: "deepseek-flash",
                    choices: [{ index: 0, ...choice }],
                  })}\n\n`,
              )
              .join("") + "data: [DONE]\n\n",
            { headers: { "Content-Type": "text/event-stream" } },
          );
        }),
      );
      await aiChatService.runConversation({
        appOptions: {
          ...DEFAULT_EDITOR_UI_STATE.options,
          llm: {
            account: {
              ...createAiConnection(),
              catalogId: "deepseek",
              apiKey: "test-key",
              apiUrl: "https://test.invalid/v1",
            },
          },
        },
        modelCache: {},
        modelKey: "account:deepseek-flash",
        messages: [{ role: "user", content: "Hello" }],
        toolRegistry: workspaceRegistry,
      });

      expect(requests).toHaveLength(1);
      const request = requests[0]!;
      const system = request.messages.find(
        (message) => message.role === "system",
      )!.content;
      expect(system).toContain("end_inclusive_anchor is inclusive");
      expect(system).toContain(
        "missingCount > 0, retry only the missing anchors",
      );
      expect(system).toContain("list_fields reports allowCustomValue true");
      expect(system).toContain("Never fill signature fields");
      expect(system).not.toContain(
        "Tool arguments and tool result field names use snake_case",
      );
      expect(system.split(AI_PAGE_COORDINATE_CONVENTION)).toHaveLength(2);

      // The workspace rules already live in their shared system section, and
      // metadata/annotation rules are reused by several tools.
      for (const rule of new Set(
        workspaceRegistry
          .getDefinitions()
          .flatMap((tool) => tool.promptInstructions ?? []),
      )) {
        expect(system.split(rule.trim())).toHaveLength(2);
      }
      const toolNames = request.tools.map((tool) => tool.function.name);
      const formRule =
        "Only call create_form_fields after the user has explicitly confirmed";
      const visualRule =
        "inspect_pages_visual renders the current edited document state";
      if (enabled) {
        expect(toolNames).toContain("create_form_fields");
        expect(toolNames).toContain("inspect_pages_visual");
        expect(system).toContain(formRule);
        expect(system).toContain(visualRule);
      } else {
        expect(toolNames).not.toContain("create_form_fields");
        expect(toolNames).not.toContain("inspect_pages_visual");
        expect(system).not.toContain(formRule);
        expect(system).not.toContain(visualRule);
      }
    },
  );
});
