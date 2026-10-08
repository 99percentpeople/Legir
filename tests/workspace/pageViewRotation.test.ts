import { describe, expect, it } from "vitest";
import {
  getPageView,
  pagePointToView,
  viewPointToPage,
  viewRectToPage,
} from "@/components/workspace/lib/pageViewRotation";
import { calculateWorkspaceFitWidthScale } from "@/components/workspace/lib/calculateWorkspaceFitScale";
import { createEditorTabSnapshotFromState } from "@/app/editorTabs/storeSnapshot";
import { createTestEditorStore, field, page } from "../helpers/editorStore";

describe("temporary document rotation", () => {
  it.each([90, 180, 270])(
    "resets a %s-degree view without modifying the document",
    (viewRotation) => {
      const store = createTestEditorStore({ viewRotation });
      const before = store.getState();
      store.getState().resetViewRotation();
      expect(store.getState().viewRotation).toBe(0);
      expect(store.getState().pages).toBe(before.pages);
      expect(store.getState().isDirty).toBe(before.isDirty);
      expect(store.getState().past).toBe(before.past);
      store.dispose();
    },
  );

  it("rotates all pages without changing PDF data, edits, dirty state or history", () => {
    const store = createTestEditorStore({
      pages: [page(0), page(1)],
      fields: [field()],
    });
    const before = store.getState();
    store.getState().rotateView("counterclockwise");
    expect(store.getState().viewRotation).toBe(270);
    for (const key of [
      "pdfBytes",
      "pages",
      "fields",
      "annotations",
      "past",
      "future",
      "isDirty",
      "dirtyPermissionScopes",
    ] as const) {
      expect(store.getState()[key]).toBe(before[key]);
    }
    expect(
      store
        .getState()
        .pages.map((p) => getPageView(p, store.getState().viewRotation).width),
    ).toEqual([800, 800]);
    store.getState().rotateView("clockwise");
    expect(store.getState().viewRotation).toBe(0);
    for (let i = 0; i < 4; i++) store.getState().rotateView("clockwise");
    expect(store.getState().viewRotation).toBe(0);
    store.dispose();
  });

  it("keeps rotation independent between documents and includes it in window transfers", () => {
    const a = createTestEditorStore();
    const b = createTestEditorStore();
    a.getState().rotateView("clockwise");
    expect(b.getState().viewRotation).toBe(0);
    const snapshot = createEditorTabSnapshotFromState({
      state: a.getState(),
      scrollContainer: null,
    });
    expect(snapshot.viewRotation).toBe(90);
    expect(snapshot.pages[0].rotation).toBe(0);
    a.getState().resetDocument();
    expect(a.getState().viewRotation).toBe(0);
    a.getState().rotateView("clockwise");
    expect(a.getState().viewRotation).toBe(0);
    a.dispose();
    b.dispose();
  });

  it.each([0, 90, 180, 270])(
    "preserves source coordinates and existing page rotation at %s degrees",
    (rotation) => {
      const source = { ...page(), rotation: 90, width: 800, height: 600 };
      const view = getPageView(source, rotation);
      expect(view.rotation).toBe((90 + rotation) % 360);
      const point = { x: 123, y: 234 };
      expect(
        viewPointToPage(
          pagePointToView(point, source, rotation),
          source,
          rotation,
        ),
      ).toEqual(point);
      expect(
        viewRectToPage(
          { x: 0, y: 0, width: view.width, height: view.height },
          source,
          rotation,
        ),
      ).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    },
  );

  it("maps a selected text rectangle back into its original page coordinates", () => {
    expect(
      viewRectToPage({ x: 650, y: 100, width: 20, height: 200 }, page(), 90),
    ).toEqual({ x: 100, y: 130, width: 200, height: 20 });
  });

  it("fits the rotated page width", () => {
    const options = {
      pages: [page()],
      pageLayout: "single" as const,
      pageFlow: "vertical" as const,
      viewport: { width: 896, height: 1000 },
    };
    expect(
      calculateWorkspaceFitWidthScale({ ...options, viewRotation: 90 }),
    ).toBe(1);
    expect(calculateWorkspaceFitWidthScale(options)).toBe(1.33);
  });
});
