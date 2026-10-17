import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Workspace from "@/components/workspace/Workspace";
import { EditorViewContext, useEditorView } from "@/store/useEditorView";
import type { ControlRendererProps } from "@/components/workspace/controls/ControlRenderer";
import type { Annotation, FormField } from "@/types";
import { createTestEditorStore, field, page } from "../helpers/editorStore";
import { appEventBus } from "@/lib/eventBus";

const renders = vi.hoisted(() => new Map<string, number>());

// Keep the real memoized dispatcher and Workspace's pointer/resize callbacks.
// Replace only control contents and PDF painting with lightweight leaves.
vi.mock("@/components/workspace/controls", async () => ({
  ...(await import("@/components/workspace/controls/ControlRenderer")),
  registerControls: () => {},
  preloadControls: () => {},
}));
vi.mock("@/components/workspace/controls/registry/ControlRegistry", () => {
  const component = ({
    data,
    onPointerDown,
    onResizeStart,
  }: ControlRendererProps<FormField | Annotation>) => {
    renders.set(data.id, (renders.get(data.id) ?? 0) + 1);
    return (
      <div data-control-id={data.id} onPointerDown={onPointerDown}>
        <button
          data-resize
          onPointerDown={(event) => {
            event.stopPropagation();
            onResizeStart?.("se", event);
          }}
        />
      </div>
    );
  };
  return { registry: { get: () => ({ component }) } };
});
vi.mock("@/components/workspace/layers/PDFPage", () => ({
  default: () => null,
}));
vi.mock("@/components/workspace/widgets/WorkspaceTextSelectionPopover", () => ({
  WorkspaceTextSelectionPopover: () => null,
}));
vi.mock("@/components/workspace/debug/modules", () => ({
  WorkspaceZoomJankOverlay: Object.assign(() => null, {
    preload: async () => {},
  }),
  PDFPageRenderDebugOverlay: Object.assign(() => null, {
    preload: async () => {},
  }),
}));
vi.mock("@/components/language-provider", () => ({
  useLanguage: () => ({ t: (key: string) => key, effectiveLanguage: "en" }),
}));
vi.mock("@/hooks/useIsMobile", () => ({ useIsMobile: () => false }));

let host: HTMLDivElement;
let root: Root;
let store: ReturnType<typeof createTestEditorStore>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  renders.clear();
  store = createTestEditorStore({
    tool: "select",
    scale: 1,
    pages: [page(0), page(1)],
    fields: [field("field")],
    annotations: [
      {
        id: "moving",
        type: "shape",
        pageIndex: 0,
        rect: { x: 10, y: 40, width: 80, height: 30 },
      },
      {
        id: "same-page",
        type: "comment",
        pageIndex: 0,
        rect: { x: 200, y: 40, width: 24, height: 24 },
      },
      {
        id: "other-page",
        type: "freetext",
        pageIndex: 1,
        rect: { x: 10, y: 40, width: 100, height: 30 },
      },
    ],
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  store.dispose();
  host.remove();
  delete document.body.dataset.appControlTransforming;
  vi.unstubAllGlobals();
});

function Canvas() {
  const state = useEditorView();
  return (
    <Workspace
      editorState={state}
      workerService={null}
      onAddField={state.addField}
      onAddAnnotation={state.addAnnotation}
      onSelectControl={state.selectControl}
      onUpdateField={state.updateField}
      onResetFieldToDefault={state.resetFieldToDefault}
      onUpdateAnnotation={state.updateAnnotation}
      onDeleteAnnotation={state.deleteAnnotation}
      onReorderControlLayer={state.reorderControlLayer}
      onEditAnnotation={editAnnotation}
      onScaleChange={state.setScale}
      onTriggerHistorySave={state.saveCheckpoint}
      onToolChange={state.setTool}
    />
  );
}
const editAnnotation = () => {};

async function setupDrag() {
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: () => {} },
    hasPointerCapture: { configurable: true, value: () => false },
    scrollTo: { configurable: true, value: () => {} },
  });
  const reads = vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element) {
      if (this.id === "page-0") return new DOMRect(0, 0, 800, 800);
      if (this.id === "page-1") return new DOMRect(0, 900, 800, 800);
      return new DOMRect(0, 0, 1000, 1000);
    });
  await act(async () =>
    root.render(
      <EditorViewContext.Provider value={store}>
        <Canvas />
      </EditorViewContext.Provider>,
    ),
  );
  return {
    reads,
    tick: () =>
      act(async () => {
        const current = [...frames.entries()];
        frames.clear();
        current.forEach(([, callback]) => callback(performance.now()));
      }),
  };
}
const control = (id = "moving") =>
  host.querySelector<HTMLElement>(`[data-control-id="${id}"]`)!;
const pointer = (element: Element, type: string, x: number, y: number) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: "mouse" },
  });
  element.dispatchEvent(event);
};

it("coalesces movement, flushes the final position on release and keeps one undo checkpoint", async () => {
  const { tick, reads } = await setupDrag();
  const original = store.getState().annotations[0];
  await act(async () => {
    pointer(control(), "pointerdown", 20, 50);
  });
  reads.mockClear();
  await act(async () => {
    for (let i = 1; i <= 8; i++)
      pointer(control(), "pointermove", 20 + i * 10, 50);
  });
  expect(store.getState().annotations[0]).toBe(original);
  await tick();
  expect(store.getState().annotations[0].rect!.x).toBe(90);
  expect(
    reads.mock.contexts.filter(
      (element) => element instanceof Element && element.id === "page-0",
    ),
  ).toHaveLength(1);
  await act(async () => {
    pointer(control(), "pointermove", 140, 70);
    pointer(control(), "pointerup", 140, 70);
  });
  const moved = store.getState().annotations[0];
  expect(moved.rect).toEqual({ x: 130, y: 60, width: 80, height: 30 });
  expect(store.getState().past).toHaveLength(1);
  await act(async () => store.getState().undo());
  await tick();
  expect(store.getState().annotations[0]).toBe(original);
  await act(async () => store.getState().redo());
  expect(store.getState().annotations[0]).toBe(moved);
});

it("delivers pending movement before a save or undo shortcut reads the document", async () => {
  const { tick } = await setupDrag();
  const original = store.getState().annotations[0];
  await act(async () => pointer(control(), "pointerdown", 20, 50));
  await act(async () => pointer(control(), "pointermove", 120, 80));
  let snapshot: Annotation | undefined;
  const save = () => {
    snapshot = store.getState().annotations[0];
  };
  window.addEventListener("keydown", save);
  try {
    await act(async () => {
      control().dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          ctrlKey: true,
          key: "s",
        }),
      );
    });
    expect(snapshot?.rect).toEqual({ x: 110, y: 70, width: 80, height: 30 });
    await tick();
    expect(store.getState().annotations[0]).toBe(snapshot);
    await act(async () => store.getState().undo());
    expect(store.getState().annotations[0]).toBe(original);
    await act(async () => store.getState().redo());
    expect(store.getState().annotations[0]).toBe(snapshot);
  } finally {
    window.removeEventListener("keydown", save);
  }
});

it.each(["cancel", "undo", "delete", "tool switch", "unmount"])(
  "does not apply queued movement after %s",
  async (ending) => {
    const { tick } = await setupDrag();
    await act(async () => {
      pointer(control(), "pointerdown", 20, 50);
    });
    await act(async () => {
      pointer(control(), "pointermove", 120, 50);
    });
    await act(async () => {
      if (ending === "cancel")
        appEventBus.emit("workspace:cancelToolInteraction", {
          draftsOnly: false,
          handled: false,
        });
      else if (ending === "undo") store.getState().undo();
      else if (ending === "delete") store.getState().deleteAnnotation("moving");
      else if (ending === "tool switch") store.getState().setTool("pan");
      else root.render(null);
    });
    const before = store.getState().annotations;
    await tick();
    expect(store.getState().annotations).toBe(before);
  },
);

it("moves across pages and preserves coordinates on a rotated page", async () => {
  store.setState({ viewRotation: 90 });
  const { tick } = await setupDrag();
  // A 90 degree view maps PDF (20, 50) to client (750, 20).
  await act(async () => {
    pointer(control(), "pointerdown", 750, 20);
  });
  await act(async () => {
    pointer(control(), "pointermove", 730, 50);
  });
  await tick();
  expect(store.getState().annotations[0].rect).toEqual({
    x: 40,
    y: 60,
    width: 80,
    height: 30,
  });
  await act(async () => {
    pointer(control(), "pointermove", 730, 950);
    pointer(control(), "pointerup", 730, 950);
  });
  expect(store.getState().annotations[0].pageIndex).toBe(1);
  expect(store.getState().annotations[0].rect).toEqual({
    x: 40,
    y: 60,
    width: 80,
    height: 30,
  });
  await act(async () => store.getState().undo());
  expect(store.getState().annotations[0].pageIndex).toBe(0);
});

it("flushes field resizing on pointercancel and allows undo/redo", async () => {
  store.setState({ mode: "form", selectedId: "field" });
  const { tick } = await setupDrag();
  await act(async () => {
    pointer(control("field").querySelector("button")!, "pointerdown", 110, 30);
  });
  await act(async () => {
    pointer(control("field"), "pointermove", 160, 60);
    pointer(control("field"), "pointercancel", 160, 60);
  });
  expect(store.getState().fields[0].rect).toEqual({
    x: 10,
    y: 10,
    width: 150,
    height: 50,
  });
  await act(async () => store.getState().undo());
  await tick();
  expect(store.getState().fields[0].rect).toEqual({
    x: 10,
    y: 10,
    width: 100,
    height: 20,
  });
  await act(async () => store.getState().redo());
  expect(store.getState().fields[0].rect.width).toBe(150);
});

it.each(["move", "resize", "cross-page", "field"])(
  "%s updates only the changed control without rerendering other controls",
  async (operation) => {
    await act(async () =>
      root.render(
        <EditorViewContext.Provider value={store}>
          <Canvas />
        </EditorViewContext.Provider>,
      ),
    );
    const before = new Map(renders);
    expect(before.size).toBe(4);
    await act(async () => {
      if (operation === "field") {
        store.getState().updateField("field", {
          rect: { ...store.getState().fields[0].rect, x: 50 },
        });
        return;
      }
      const annotation = store.getState().annotations[0];
      store.getState().updateAnnotation(annotation.id, {
        rect: {
          ...annotation.rect!,
          x: 50,
          width: operation === "resize" ? 120 : 80,
        },
        ...(operation === "cross-page" ? { pageIndex: 1 } : {}),
      });
    });
    const changedId = operation === "field" ? "field" : "moving";
    expect(renders.get(changedId)).toBeGreaterThan(before.get(changedId)!);
    for (const id of [...before.keys()].filter((id) => id !== changedId)) {
      expect(renders.get(id), id).toBe(before.get(id));
    }
  },
);
