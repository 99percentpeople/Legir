import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Workspace from "@/components/workspace/Workspace";
import { EditorViewContext, useEditorView } from "@/store/useEditorView";
import type { ControlRendererProps } from "@/components/workspace/controls/ControlRenderer";
import type { Annotation, FormField } from "@/types";
import { createTestEditorStore, field, page } from "../helpers/editorStore";

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
  }: ControlRendererProps<FormField | Annotation>) => {
    renders.set(data.id, (renders.get(data.id) ?? 0) + 1);
    return <div data-control-id={data.id} />;
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
