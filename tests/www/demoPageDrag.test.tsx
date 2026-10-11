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
  const over = (target: string | null) =>
    act(() =>
      drag.onDragOver({
        operation: { target: target ? { id: target } : null },
      } as DragOverEvent),
    );
  const end = (canceled: boolean, target: string | null = "sample-3") =>
    act(() =>
      drag.onDragEnd({
        canceled,
        operation: { target: target ? { id: target } : null },
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
  it("drops into the last preview position after leaving all cards", async () => {
    await over("sample-2");
    await over("sample-3");
    const preview = ids();
    await over(null);
    expect(ids()).toEqual(preview);
    expect(state.past).toHaveLength(0);
    await end(false, null);
    expect(ids()).toEqual(preview);
    expect(state.pages.map((page) => page.id)).toEqual(preview);
    expect(state.past).toHaveLength(1);
    await act(async () => dispatch({ type: "undo" }));
    expect(ids()).toEqual(initial);
    await act(async () => dispatch({ type: "redo" }));
    expect(ids()).toEqual(preview);
  });
  it.each(["sample-3", null])(
    "restores the original order without history when cancelled over %s",
    async (target) => {
      await over("sample-3");
      await over(target);
      expect(ids()).not.toEqual(initial);
      await end(true, target);
      expect(ids()).toEqual(initial);
      expect(state.pages).toBe(initialDemoState.pages);
      expect(state.past).toHaveLength(0);
    },
  );
  it("does not create a move when released outside before any insertion", async () => {
    await over(null);
    await end(false, null);
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
  it.each(["sample-3", null])(
    "does not overwrite page edits when released over %s",
    async (target) => {
      await over("sample-3");
      await act(async () => dispatch({ type: "blank-page" }));
      const editedPages = state.pages;
      await end(false, target);
      expect(state.pages).toBe(editedPages);
      expect(ids()).toEqual([...initial, "sample-4"]);
      expect(state.past).toHaveLength(1);
    },
  );
  it.each(["window", "ancestor"])(
    "reveals the committed slot when %s scrolls during the drop animation",
    async (scrollTarget) => {
      await over("sample-3");
      await end(false, null);
      const grid = container.firstElementChild!;
      grid.innerHTML =
        '<div data-page-card="sample-1"><button class="demo-page-handle"></button></div>';
      const feedback = document.createElement("div");
      const preview = document.createElement("div");
      preview.dataset.demoPageDragPreview = "sample-1";
      feedback.append(preview);
      vi.spyOn(preview, "getBoundingClientRect").mockReturnValue(
        new DOMRect(400, 400, 100, 150),
      );
      vi.spyOn(
        grid.querySelector("button")!,
        "getBoundingClientRect",
      ).mockReturnValue(new DOMRect(100, 100, 100, 150));
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => (finish = resolve));
      const cancel = vi.fn(() => finish());
      preview.animate = vi.fn(
        () => ({ finished, cancel }) as unknown as Animation,
      );
      await act(async () => {
        const pending = drag.dropAnimation({
          source: { id: "sample-1" } as unknown as Parameters<
            typeof drag.dropAnimation
          >[0]["source"],
          element: grid.querySelector("button")!,
          feedbackElement: feedback,
          placeholder: undefined,
          translate: { x: 0, y: 0 },
          moved: true,
        });
        try {
          (scrollTarget === "window" ? window : container).dispatchEvent(
            new Event("scroll"),
          );
          expect(cancel).toHaveBeenCalledOnce();
        } finally {
          finish();
          await pending;
        }
      });
      expect(preview.style.visibility).toBe("hidden");
      expect(drag.moving).toEqual([]);
      expect(ids()).toEqual(["sample-2", "sample-3", "sample-1"]);
      expect(state.past).toHaveLength(1);
    },
  );
});
