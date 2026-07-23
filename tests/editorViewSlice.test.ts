import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";

import { MAX_EDITOR_SCALE, MIN_EDITOR_SCALE } from "@/constants";
import { UNRESTRICTED_PDF_PERMISSIONS } from "@/lib/pdfPermissions";
import { createEditorViewSlice } from "@/store/slices/editorViewSlice";
import type { EditorStore } from "@/store/store.types";

const createTestStore = () =>
  createStore<EditorStore>()(
    (set, get) =>
      ({
        scale: 1,
        fitTrigger: 0,
        pageLayout: "single",
        pageFlow: "vertical",
        documentPermissions: null,
        mode: "annotation",
        tool: "select",
        isFullscreen: false,
        ...createEditorViewSlice(set, get),
      }) as EditorStore,
  );

describe("editor view actions", () => {
  it("uses the same scale bounds for direct and relative zoom", () => {
    const store = createTestStore();

    store.getState().setScale(10);
    expect(store.getState().scale).toBe(MAX_EDITOR_SCALE);

    store.getState().zoomBy(0.01);
    expect(store.getState().scale).toBe(MIN_EDITOR_SCALE);

    store.getState().zoomBy(2);
    expect(store.getState().scale).toBe(MIN_EDITOR_SCALE * 2);
  });

  it("signals a fit when applying fit scale or changing layout", () => {
    const store = createTestStore();
    const initialTrigger = store.getState().fitTrigger;

    store.getState().fitToScale(1.5);
    const fitTrigger = store.getState().fitTrigger;
    expect(store.getState().scale).toBe(1.5);
    expect(fitTrigger).toBeGreaterThan(initialTrigger);

    store.getState().setPageLayout("double_odd");
    const layoutTrigger = store.getState().fitTrigger;
    expect(store.getState().pageLayout).toBe("double_odd");
    expect(layoutTrigger).toBeGreaterThan(fitTrigger);

    store.getState().setPageFlow("horizontal");
    expect(store.getState().pageFlow).toBe("horizontal");
    expect(store.getState().fitTrigger).toBeGreaterThan(layoutTrigger);
  });

  it("keeps editor mode permission checks inside the action", () => {
    const store = createTestStore();
    store.setState({
      documentPermissions: {
        ...UNRESTRICTED_PDF_PERMISSIONS,
        canModifyAnnotations: false,
      },
      mode: "form",
      tool: "draw_text",
    });

    store.getState().setEditorMode("annotation", "pan");
    expect(store.getState().mode).toBe("form");
    expect(store.getState().tool).toBe("select");

    store.setState({ documentPermissions: UNRESTRICTED_PDF_PERMISSIONS });
    store.getState().setEditorMode("annotation", "pan");
    expect(store.getState().mode).toBe("annotation");
    expect(store.getState().tool).toBe("pan");
  });

  it("updates fullscreen state through its semantic action", () => {
    const store = createTestStore();

    store.getState().setEditorFullscreen(true);
    expect(store.getState().isFullscreen).toBe(true);

    store.getState().setEditorFullscreen(false);
    expect(store.getState().isFullscreen).toBe(false);
  });
});
