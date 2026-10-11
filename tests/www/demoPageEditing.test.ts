import { describe, expect, it } from "vitest";
import {
  demoReducer,
  initialDemoState,
  sourcePageNumber,
} from "../../www/src/components/workspace-demo/types";
import { demoPageSize } from "../../www/src/components/workspace-demo/geometry";

describe("page editing in the public demo", () => {
  it("reorders a page without losing its identity or the reader position", () => {
    const state = demoReducer(initialDemoState, {
      type: "move-pages",
      ids: ["sample-1"],
      beforeIndex: 3,
    });
    expect(state.pages.map((page) => page.id)).toEqual([
      "sample-2",
      "sample-3",
      "sample-1",
    ]);
    expect(state.pages[2]).toBe(initialDemoState.pages[0]);
    expect(state.page).toBe(3);
    expect(state.past).toHaveLength(1);
    expect(sourcePageNumber(state, 2)).toBe(1);
    expect(demoReducer(state, { type: "mode", mode: "forms" }).page).toBe(1);
    expect(demoReducer(state, { type: "mode", mode: "annotate" }).page).toBe(3);
    expect(demoReducer(state, { type: "undo" }).pages).toBe(
      initialDemoState.pages,
    );
    expect(
      demoReducer(initialDemoState, {
        type: "move-pages",
        ids: ["sample-1"],
        beforeIndex: 1,
      }),
    ).toBe(initialDemoState);
  });
  it("keeps selection and rotation consistent through undo and redo", () => {
    let state = demoReducer(initialDemoState, {
      type: "select-pages",
      id: "sample-2",
      intent: "single",
    });
    state = demoReducer(state, {
      type: "select-pages",
      id: "sample-3",
      intent: "single",
    });
    expect(state.selectedPageIds).toEqual(["sample-3"]);
    state = demoReducer(state, {
      type: "rotate-pages",
      ids: state.selectedPageIds,
      delta: -90,
    });
    expect(state.pages.map((page) => page.rotation)).toEqual([0, 0, 270]);
    expect(demoPageSize(state.pages[2]).width).toBeGreaterThan(
      demoPageSize(state.pages[2]).height,
    );
    expect(state.pages[0]).toBe(initialDemoState.pages[0]);
    state = demoReducer(state, { type: "undo" });
    expect(state.pages).toBe(initialDemoState.pages);
    expect(state.selectedPageIds).toEqual(["sample-3"]);
    state = demoReducer(state, { type: "redo" });
    expect(state.pages[2].rotation).toBe(270);
  });
});
