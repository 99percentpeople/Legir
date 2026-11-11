import { afterEach, describe, expect, it } from "vitest";
import { createTestEditorStore, field, page } from "./helpers/editorStore";
import {
  commitDocumentSaveState,
  isSavedDocumentRevision,
} from "@/app/editorTabs/saveState";
import { createEditorTabSnapshotFromState } from "@/app/editorTabs/storeSnapshot";
import { createEditorView } from "@/store/editorView";

const stores: ReturnType<typeof createEditorView>[] = [];
const create = (
  overrides: Parameters<typeof createTestEditorStore>[0] = {},
) => {
  const store = createTestEditorStore({
    fields: [field("a", { value: "original" })],
    ...overrides,
  });
  stores.push(store);
  return store;
};
const edit = (store: ReturnType<typeof createEditorView>, value: string) => {
  store.getState().saveCheckpoint();
  store.getState().updateField("a", { value });
};
const save = (
  store: ReturnType<typeof createEditorView>,
  snapshot = store.getState(),
) =>
  commitDocumentSaveState(
    store,
    snapshot,
    { kind: "tauri", path: "/saved.pdf" },
    "saved.pdf",
  );
afterEach(() => stores.splice(0).forEach((store) => store.dispose()));

describe("document save baseline", () => {
  it("clears dirty state only when undo reaches the loaded content, including page edits", () => {
    const store = create();
    edit(store, "edited");
    store
      .getState()
      .addBlankPages({ width: 300, height: 400, count: 1, at: 1 });
    expect(store.getState().isDirty).toBe(true);
    store.getState().undo();
    expect(store.getState().isDirty).toBe(true);
    store.getState().undo();
    expect(store.getState().fields[0].value).toBe("original");
    expect(store.getState().isDirty).toBe(false);
    expect(
      Object.values(store.getState().dirtyPermissionScopes).some(Boolean),
    ).toBe(false);
    store.getState().redo();
    expect(store.getState().isDirty).toBe(true);
  });

  it("does not mark a focus-only history checkpoint or view changes as unsaved", () => {
    const store = create();
    store.getState().saveCheckpoint();
    store.setState({ scale: 2, viewRotation: 90, selectedId: "a" });
    store.getState().undo();
    expect(store.getState().isDirty).toBe(false);
    store.getState().redo();
    expect(store.getState().isDirty).toBe(false);
  });

  it("uses the most recent save rather than an old clean flag in undo history", () => {
    const store = create();
    edit(store, "saved");
    save(store);
    store.getState().undo();
    expect(store.getState().fields[0].value).toBe("original");
    expect(store.getState().isDirty).toBe(true);
    store.getState().redo();
    expect(store.getState().fields[0].value).toBe("saved");
    expect(store.getState().isDirty).toBe(false);
    edit(store, "later");
    store.getState().undo();
    expect(store.getState().isDirty).toBe(false);
  });

  it("keeps concurrent edits dirty and lets undo return to the revision actually written", () => {
    const store = create();
    edit(store, "saving");
    const snapshot = store.getState();
    edit(store, "concurrent edit");
    expect(save(store, snapshot)).toBe(false);
    expect(store.getState().isDirty).toBe(true);
    store.getState().undo();
    expect(store.getState().fields[0].value).toBe("saving");
    expect(store.getState().isDirty).toBe(false);
    store.getState().undo();
    expect(store.getState().isDirty).toBe(true);
  });

  it("includes annotation and metadata changes in the saved content", () => {
    const store = create({
      annotations: [
        {
          id: "note",
          type: "freetext",
          pageIndex: 0,
          text: "original",
          rect: { x: 0, y: 0, width: 100, height: 40 },
        },
      ],
    });
    store.getState().saveCheckpoint();
    store.getState().updateAnnotation("note", { text: "changed" });
    store.getState().saveCheckpoint();
    store.getState().updateMetadata({ title: "changed title" });
    store.getState().undo();
    expect(store.getState().isDirty).toBe(true);
    store.getState().undo();
    expect(store.getState().isDirty).toBe(false);
  });

  it("does not clear changes outside undo history when a field is restored", () => {
    const store = create();
    edit(store, "edited");
    store.setState({
      preservePdfOwnerRestrictionsOnSave:
        !store.getState().preservePdfOwnerRestrictionsOnSave,
      isDirty: true,
    });
    store.getState().undo();
    expect(store.getState().fields[0].value).toBe("original");
    expect(store.getState().isDirty).toBe(true);
  });

  it("carries the baseline with cloned tab snapshots without mixing documents", () => {
    const a = create();
    const b = create();
    edit(a, "edited");
    const snapshot = structuredClone(
      createEditorTabSnapshotFromState({
        state: a.getState(),
        scrollContainer: null,
      }),
    );
    const restored = createEditorView({ state: snapshot });
    stores.push(restored);
    restored.getState().undo();
    expect(restored.getState().isDirty).toBe(false);
    expect(a.getState().isDirty).toBe(true);
    expect(b.getState().isDirty).toBe(false);
  });

  it("clears the old baseline when loading another document", () => {
    const store = create();
    edit(store, "first document");
    store.getState().loadDocument({
      pdfFile: null,
      pdfBytes: new Uint8Array([2]),
      pages: [page()],
      fields: [field("a", { value: "second original" })],
      annotations: [],
      preservedSourceAnnotations: [],
      outline: [],
      metadata: {},
      documentPermissions: null,
      filename: "second.pdf",
      scale: 1,
      saveTarget: null,
      documentLoadState: "ready",
    });
    edit(store, "second edited");
    store.getState().undo();
    expect(store.getState().fields[0].value).toBe("second original");
    expect(store.getState().isDirty).toBe(false);
  });

  it("does not clear concurrent outline or preserved-annotation changes on save", () => {
    const store = create();
    const snapshot = store.getState();
    store.setState({
      preservedSourceAnnotations: [
        {
          pageIndex: 0,
          sourcePdfRef: { objectNumber: 3, generationNumber: 0 },
          subtype: "Text",
        },
      ],
      isDirty: true,
    });
    expect(isSavedDocumentRevision(store.getState(), snapshot)).toBe(false);
    expect(save(store, snapshot)).toBe(false);
    expect(store.getState().isDirty).toBe(true);
  });
});
