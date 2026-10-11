import React, { act, useReducer, useRef, type Dispatch } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/dom";
import { useDemoPageDrag } from "../../www/src/components/workspace-demo/useDemoPageDrag";
import {
  demoReducer,
  initialDemoState,
  type DemoAction,
  type DemoState,
} from "../../www/src/components/workspace-demo/types";

describe("page drag previews in the public demo", () => {
  let root: Root;
  let container: HTMLDivElement;
  let state: DemoState;
  let dispatch: Dispatch<DemoAction>;
  let drag: ReturnType<typeof useDemoPageDrag>;
  function Harness() {
    [state, dispatch] = useReducer(demoReducer, initialDemoState);
    const grid = useRef<HTMLDivElement>(null);
    drag = useDemoPageDrag(grid, state, dispatch);
    return <div ref={grid} />;
  }
  const ids = () => drag.displayed.map((page) => page.id);
  const initial = initialDemoState.pages.map((page) => page.id);
  const over = (target: string) =>
    act(() =>
      drag.onDragOver({
        operation: { target: { id: target } },
      } as DragOverEvent),
    );
  const end = (canceled: boolean) =>
    act(() =>
      drag.onDragEnd({
        canceled,
        operation: { target: { id: "sample-3" } },
      } as DragEndEvent),
    );
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
    await act(async () =>
      drag.onDragStart({
        operation: { source: { id: "sample-1" } },
      } as DragStartEvent),
    );
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  it("previews each insertion before release and commits one undo step", async () => {
    await over("sample-2");
    expect(ids()).toEqual(["sample-2", "sample-1", "sample-3"]);
    await over("sample-3");
    expect(ids()).toEqual(["sample-2", "sample-3", "sample-1"]);
    expect(state.pages).toBe(initialDemoState.pages);
    expect(state.past).toHaveLength(0);
    await end(false);
    expect(state.pages.map((page) => page.id)).toEqual(ids());
    expect(state.past).toHaveLength(1);
    expect(state.pages[2]).toBe(initialDemoState.pages[0]);
    await act(async () => dispatch({ type: "undo" }));
    expect(ids()).toEqual(initial);
  });
  it("restores the original order without history when cancelled", async () => {
    await over("sample-3");
    expect(ids()).not.toEqual(initial);
    await end(true);
    expect(ids()).toEqual(initial);
    expect(state.pages).toBe(initialDemoState.pages);
    expect(state.past).toHaveLength(0);
  });
  it("can move back to the original position without creating an undo step", async () => {
    await over("sample-3");
    await over("sample-2");
    expect(ids()).toEqual(initial);
    await end(false);
    expect(state.past).toHaveLength(0);
  });
  it("does not overwrite page edits made during the drag", async () => {
    await over("sample-3");
    await act(async () => dispatch({ type: "blank-page" }));
    const editedPages = state.pages;
    await end(false);
    expect(state.pages).toBe(editedPages);
    expect(ids()).toEqual([...initial, "sample-4"]);
    expect(state.past).toHaveLength(1);
  });
});
