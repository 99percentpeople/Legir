import { afterEach, describe, expect, it } from "vitest";
import { createTestEditorStore, field, page } from "./helpers/editorStore";
import {
  copySelectedControls,
  readControlClipboard,
  writeControlClipboard,
} from "@/lib/controlClipboard";
import { createClipboardData } from "@/lib/clipboard";
import { FieldType, type Annotation } from "@/types";
import { UNRESTRICTED_PDF_PERMISSIONS } from "@legir/pdf-model/pdfPermissions";

const stores: ReturnType<typeof createTestEditorStore>[] = [];
const create = (state: Parameters<typeof createTestEditorStore>[0] = {}) => {
  const store = createTestEditorStore({
    mode: "form",
    fields: [
      field("a"),
      field("b", { rect: { x: 180, y: 50, width: 100, height: 20 } }),
    ],
    ...state,
  });
  stores.push(store);
  return store;
};
afterEach(() => stores.splice(0).forEach((store) => store.dispose()));
const selectBoth = (store: ReturnType<typeof create>) => {
  store.getState().selectControl("a");
  store.getState().selectControl("b", "toggle");
};

describe("control multi-selection", () => {
  it("toggles members, keeps a primary member and preserves groups for menus", () => {
    const store = create();
    selectBoth(store);
    store.getState().selectControl("a", "preserve");
    expect(store.getState().selectedControlIds).toEqual(["a", "b"]);
    store.getState().selectControl("b", "toggle");
    expect(store.getState()).toMatchObject({
      selectedControlIds: ["a"],
      selectedId: "a",
    });
    store.getState().selectControl("a", "toggle");
    expect(store.getState()).toMatchObject({
      selectedControlIds: [],
      selectedId: null,
      past: [],
      isDirty: false,
    });
  });

  it("limits groups to one page and kind, and clears them when mode changes", () => {
    const store = create({
      fields: [field("a"), field("b", { pageIndex: 1 })],
      pages: [page(0), page(1)],
    });
    selectBoth(store);
    expect(store.getState().selectedControlIds).toEqual(["b"]);
    store.setState({ mode: "annotation" });
    expect(store.getState().selectedControlIds).toEqual([]);
  });

  it("prunes missing members and keeps separate document selections", () => {
    const store = create();
    const other = create();
    selectBoth(store);
    store.setState({ fields: [store.getState().fields[0]] });
    expect(store.getState()).toMatchObject({
      selectedControlIds: ["a"],
      selectedId: "a",
    });
    expect(other.getState().selectedControlIds).toEqual([]);
    store.getState().selectControl(null);
    expect(store.getState().selectedControlIds).toEqual([]);
  });

  it("deletes the group in one undo step and restores it on undo", () => {
    const store = create();
    selectBoth(store);
    store.getState().deleteSelection();
    expect(store.getState()).toMatchObject({
      fields: [],
      selectedControlIds: [],
      selectedId: null,
    });
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().fields.map((field) => field.id)).toEqual([
      "a",
      "b",
    ]);
    store.getState().redo();
    expect(store.getState().fields).toEqual([]);
  });

  it("checks the whole operation before changing data or history", () => {
    const store = create({
      documentPermissions: {
        ...UNRESTRICTED_PDF_PERMISSIONS,
        canModifyContents: false,
      },
    });
    selectBoth(store);
    expect(() => store.getState().deleteSelection()).toThrow();
    expect(() =>
      store.getState().translateSelectedControls(10, 20, true),
    ).toThrow();
    expect(store.getState().fields).toHaveLength(2);
    expect(store.getState().past).toHaveLength(0);
  });

  it("does not partially edit a selection containing a signed signature", () => {
    const store = create({
      fields: [
        field("a"),
        field("b", { type: FieldType.SIGNATURE, signature: { present: true } }),
      ],
    });
    selectBoth(store);
    store.getState().deleteSelection();
    store.getState().translateSelectedControls(20, 30, true);
    expect(store.getState().fields).toHaveLength(2);
    expect(store.getState().past).toHaveLength(0);
  });

  it("moves all members together and supports one undo for repeated arrow movement", () => {
    const store = create();
    selectBoth(store);
    store.getState().moveSelectedControl("RIGHT", true);
    store.getState().moveSelectedControl("RIGHT", true, false);
    expect(store.getState().fields.map((field) => field.rect.x)).toEqual([
      30, 200,
    ]);
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().fields.map((field) => field.rect.x)).toEqual([
      10, 180,
    ]);
  });

  it("moves imported ink strokes and highlight rectangles with their rendered bounds", () => {
    const annotations: Annotation[] = [
      {
        id: "a",
        type: "ink",
        pageIndex: 0,
        rect: { x: 10, y: 10, width: 20, height: 20 },
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 30 },
        ],
        strokes: [
          [
            { x: 10, y: 10 },
            { x: 30, y: 30 },
          ],
        ],
        sourcePdfRef: { objectNumber: 1, generationNumber: 0 },
      },
      {
        id: "b",
        type: "highlight",
        pageIndex: 0,
        rect: { x: 50, y: 60, width: 20, height: 10 },
        rects: [{ x: 50, y: 60, width: 20, height: 10 }],
      },
    ];
    const store = create({ mode: "annotation", fields: [], annotations });
    selectBoth(store);
    store.getState().translateSelectedControls(12, 15, true);
    expect(store.getState().annotations[0]).toMatchObject({
      points: [
        { x: 22, y: 25 },
        { x: 42, y: 45 },
      ],
      isEdited: true,
    });
    expect(store.getState().annotations[1].rects?.[0]).toMatchObject({
      x: 62,
      y: 75,
    });
    store.getState().undo();
    expect(store.getState().annotations).toEqual(annotations);
  });

  it("duplicates fields independently with unique names, while retaining radio groups", () => {
    const store = create({
      fields: [
        field("a", { name: "name" }),
        field("existing", { name: "name_1" }),
        field("radio", {
          name: "group",
          type: FieldType.RADIO,
          isChecked: true,
          isDefaultChecked: true,
        }),
      ],
    });
    store.getState().duplicateControls(["a", "radio"], 15, 25);
    expect(store.getState().fields[3]).toMatchObject({
      name: "name_2",
      rect: { x: 25, y: 35 },
    });
    expect(store.getState().fields[4]).toMatchObject({
      name: "group",
      isChecked: false,
      isDefaultChecked: false,
    });
    expect(store.getState().past).toHaveLength(1);
  });

  it("rejects duplicate creation before history/data changes when permissions deny it", () => {
    const store = create({
      documentPermissions: {
        ...UNRESTRICTED_PDF_PERMISSIONS,
        canModifyContents: false,
      },
    });
    expect(() =>
      store.getState().duplicateControls(["a", "b"], 12, 12),
    ).toThrow();
    expect(store.getState().fields).toHaveLength(2);
    expect(store.getState().past).toHaveLength(0);
  });

  it("duplicates imported ink/highlights in layer order without changing sources", () => {
    const annotations: Annotation[] = [
      {
        id: "a",
        type: "ink",
        pageIndex: 0,
        layerOrder: 2,
        rect: { x: 10, y: 10, width: 20, height: 20 },
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 30 },
        ],
        strokes: [
          [
            { x: 10, y: 10 },
            { x: 30, y: 30 },
          ],
        ],
        sourcePdfRef: { objectNumber: 1, generationNumber: 0 },
      },
      {
        id: "b",
        type: "highlight",
        pageIndex: 0,
        layerOrder: 1,
        rect: { x: 50, y: 60, width: 20, height: 10 },
        rects: [{ x: 50, y: 60, width: 20, height: 10 }],
      },
    ];
    const store = create({ mode: "annotation", fields: [], annotations });
    store.getState().duplicateControls(["a", "b"], 12, 15);
    expect(store.getState().annotations.slice(0, 2)).toEqual(annotations);
    const [highlight, ink] = store.getState().annotations.slice(2);
    expect(highlight.rects?.[0]).toMatchObject({ x: 62, y: 75 });
    expect(ink.points?.[0]).toEqual({ x: 22, y: 25 });
    expect(ink.sourcePdfRef).toBeUndefined();
    expect(highlight.layerOrder).toBeLessThan(ink.layerOrder!);
    store.getState().undo();
    expect(store.getState().annotations).toEqual(annotations);
  });

  it("round-trips group clipboard, preserves relative offsets at edges, and pastes atomically", () => {
    const source = create({
      fields: [
        field("a", {
          name: "same",
          sourcePdfRef: { objectNumber: 1, generationNumber: 0 },
        }),
        field("b", {
          name: "same",
          rect: { x: 180, y: 50, width: 100, height: 20 },
        }),
      ],
    });
    selectBoth(source);
    const clipboard = createClipboardData();
    writeControlClipboard(
      clipboard,
      copySelectedControls(source.getState(), "a")!,
    );
    const payload = readControlClipboard(
      createClipboardData(clipboard.getData("text/plain")),
    )!;
    expect(payload.version).toBe(2);
    const target = create({ fields: [], pages: [{ ...page(), id: "target" }] });
    expect(
      target
        .getState()
        .pasteControl(payload, { pageId: "target", x: 590, y: 790 }),
    ).toBe(true);
    const pasted = target.getState().fields;
    expect(pasted[1].rect.x - pasted[0].rect.x).toBe(170);
    expect(pasted[1].rect.y - pasted[0].rect.y).toBe(40);
    expect(pasted[1].rect.x + pasted[1].rect.width).toBe(600);
    expect(new Set(pasted.map((field) => field.name)).size).toBe(2);
    expect(
      pasted.every(
        (field) => !["a", "b"].includes(field.id) && !field.sourcePdfRef,
      ),
    ).toBe(true);
    expect(target.getState().selectedControlIds).toEqual(
      pasted.map((field) => field.id),
    );
    expect(target.getState().past).toHaveLength(1);
    target.getState().undo();
    expect(target.getState().fields).toEqual([]);
    target.getState().redo();
    expect(target.getState().fields).toEqual(pasted);
  });
});
