import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EditorTabActiveContext,
  EditorTabContext,
} from "@/app/editorTabs/context";
import type { EditorTabRuntime } from "@/app/editorTabs/runtime";
import { EventBus, type AppEventMap } from "@/lib/eventBus";
import { useEditorToolActions } from "@/hooks/useEditorToolActions";
import { EditorViewContext } from "@/store/useEditorView";
import { TOOL_DEFINITIONS } from "@/components/toolbar/toolDefinitions";
import type { Tool } from "@/types";
import { createTestEditorStore } from "./helpers/editorStore";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function setup() {
  const store = createTestEditorStore({ isDirty: true });
  const events = new EventBus<AppEventMap>();
  const runtime = { store, events, active: true } as EditorTabRuntime;
  let actions: ReturnType<typeof useEditorToolActions>;
  function Probe({ defaultTool }: { defaultTool: Tool }) {
    actions = useEditorToolActions(defaultTool);
    return <button onClick={actions.exitTool}>exit</button>;
  }
  return {
    store,
    events,
    get actions() {
      return actions!;
    },
    render: async (defaultTool: Tool = "select", active = true) =>
      act(async () =>
        root.render(
          <EditorTabContext.Provider value={runtime}>
            <EditorTabActiveContext.Provider value={active}>
              <EditorViewContext.Provider value={store}>
                <Probe defaultTool={defaultTool} />
              </EditorViewContext.Provider>
            </EditorTabActiveContext.Provider>
          </EditorTabContext.Provider>,
        ),
      ),
  };
}

describe("unified tool actions", () => {
  it("retains custom highlight defaults after leaving and reselecting the tool", async () => {
    const test = setup();
    await test.render();
    const style = { color: "#00aaff", thickness: 3, opacity: 0.25 };
    test.store.setState({ highlightStyle: style, tool: "draw_highlight" });
    test.actions.exitTool();
    test.actions.changeTool("draw_highlight");
    expect(test.store.getState().highlightStyle).toEqual(style);
  });
  it.each(["select", "pan"] as const)(
    "exits every tool to %s without changing completed edits",
    async (defaultTool) => {
      const test = setup();
      await test.render(defaultTool);
      const cancelled = vi.fn();
      test.events.on("workspace:cancelToolInteraction", cancelled);
      for (const tool of Object.keys(TOOL_DEFINITIONS) as Tool[]) {
        test.store.setState({ tool, selectedId: "existing-control" });
        const before = test.store.getState();
        await act(async () => host.querySelector("button")!.click());
        const after = test.store.getState();
        expect(after.tool).toBe(defaultTool);
        expect(after.selectedId).toBeNull();
        expect(after.annotations).toBe(before.annotations);
        expect(after.fields).toBe(before.fields);
        expect(after.isDirty).toBe(true);
        expect(after.past).toBe(before.past);
        expect(after.future).toBe(before.future);
      }
      expect(cancelled).toHaveBeenCalledTimes(
        Object.keys(TOOL_DEFINITIONS).length,
      );
    },
  );

  it("cancels a draft before exit and does not restore a tool after releasing Space", async () => {
    const test = setup();
    await test.render();
    let draft = true;
    test.events.on("workspace:cancelToolInteraction", (request) => {
      request.handled = draft;
      draft = false;
    });
    test.store.setState({ tool: "draw_shape_polygon" });
    expect(test.actions.cancelToolDraft()).toBe(true);
    expect(test.store.getState().tool).toBe("draw_shape_polygon");
    expect(test.actions.cancelToolDraft()).toBe(false);
    const previous = test.store.getState().beginTemporaryPan();
    test.actions.exitTool();
    test.store.getState().endTemporaryPan(previous);
    expect(test.store.getState().tool).toBe("select");
    expect(test.store.getState().keys.space).toBe(false);
  });

  it("cancels pending interactions only on a real tool change", async () => {
    const test = setup();
    await test.render();
    const cancelled = vi.fn();
    test.events.on("workspace:cancelToolInteraction", cancelled);
    test.actions.changeTool("draw_ink");
    test.actions.changeTool("draw_ink");
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("never resets another tab and ignores inactive toolbar actions", async () => {
    const test = setup();
    const other = createTestEditorStore({ tool: "draw_ink" });
    await test.render();
    test.actions.changeTool("eraser");
    test.actions.exitTool();
    expect(other.getState().tool).toBe("draw_ink");
    await test.render("select", false);
    test.store.setState({ tool: "draw_comment" });
    test.actions.exitTool();
    test.actions.changeTool("pan");
    expect(test.actions.cancelToolDraft()).toBe(false);
    expect(test.store.getState().tool).toBe("draw_comment");
  });

  it("respects the readable-first restriction when exiting before metadata is ready", async () => {
    const test = setup();
    await test.render();
    test.store.setState({ documentLoadState: "hydrating", tool: "pan" });
    test.actions.exitTool();
    expect(test.store.getState().tool).toBe("select_text");
  });
});
