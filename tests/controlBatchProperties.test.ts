import { afterEach, describe, expect, it } from "vitest";
import { createTestEditorStore, field } from "./helpers/editorStore";
import { FieldType, type Annotation } from "@/types";
import { UNRESTRICTED_PDF_PERMISSIONS } from "@legir/pdf-model/pdfPermissions";
import {
  getCommonControlProperties,
  getCommonPropertyValue,
} from "@/lib/controlProperties";

const stores: ReturnType<typeof createTestEditorStore>[] = [];
const create = (state: Parameters<typeof createTestEditorStore>[0] = {}) => {
  const store = createTestEditorStore({
    mode: "form",
    fields: [field("a"), field("b")],
    ...state,
  });
  store.getState().selectControl("a");
  store.getState().selectControl("b", "toggle");
  stores.push(store);
  return store;
};
afterEach(() => stores.splice(0).forEach((s) => s.dispose()));
const annotation = (
  id: string,
  patch: Partial<Annotation> = {},
): Annotation => ({
  id,
  type: "freetext",
  pageIndex: 0,
  rect: { x: 10, y: 10, width: 100, height: 50 },
  ...patch,
});

describe("batch control properties", () => {
  it("offers only shared capabilities and displays effective mixed defaults", () => {
    const controls = [field("a"), field("b", { multiline: true })];
    const properties = getCommonControlProperties(controls);
    expect(
      getCommonPropertyValue(
        controls,
        properties.find((p) => p.key === "verticalAlignment")!,
      ),
    ).toBeUndefined();
    expect(
      getCommonPropertyValue(
        controls,
        properties.find((p) => p.key === "horizontalAlignment")!,
      ),
    ).toBe("left");
    expect(
      getCommonControlProperties([
        field("a"),
        field("b", { type: FieldType.CHECKBOX }),
      ]).map((p) => p.key),
    ).not.toContain("fontSize");
    expect(
      getCommonControlProperties([
        annotation("a"),
        annotation("b", { type: "shape" }),
      ]).map((p) => p.key),
    ).toEqual(["color", "opacity"]);
    expect(
      getCommonControlProperties([
        annotation("a", { type: "highlight" }),
        annotation("b", { type: "ink" }),
      ]).map((p) => p.key),
    ).toEqual(["color", "opacity"]);
  });
  it("merges only selected styles, publishes once and undoes/redoes the entire operation", () => {
    const fields = [
      field("a", { style: { fontSize: 10, borderColor: "#ff0000" } }),
      field("b", { style: { fontSize: 20, backgroundColor: "#aabbcc" } }),
      field("c"),
    ];
    const store = create({ fields });
    let publications = 0;
    const unsubscribe = store.subscribe((next, prev) => {
      if (next.fields !== prev.fields) publications++;
    });
    expect(store.getState().updateSelectedControlProperty("fontSize", 24)).toBe(
      true,
    );
    expect(publications).toBe(1);
    expect(store.getState().fields[0].style).toEqual({
      fontSize: 24,
      borderColor: "#ff0000",
    });
    expect(store.getState().fields[1].style).toEqual({
      fontSize: 24,
      backgroundColor: "#aabbcc",
    });
    expect(store.getState().fields[2]).toBe(fields[2]);
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().fields).toEqual(fields);
    store.getState().redo();
    expect(
      store
        .getState()
        .fields.slice(0, 2)
        .map((f) => f.style?.fontSize),
    ).toEqual([24, 24]);
    unsubscribe();
  });
  it("preserves PDF same-name field linking for flags and alignment", () => {
    const store = create({
      fields: [
        field("a", { name: "linked" }),
        field("b"),
        field("c", { name: "linked" }),
        field("d"),
      ],
    });
    store
      .getState()
      .updateSelectedControlProperty("horizontalAlignment", "right");
    expect(store.getState().fields.map((f) => f.horizontalAlignment)).toEqual([
      "right",
      "right",
      "right",
      undefined,
    ]);
    store.getState().updateSelectedControlProperty("required", true);
    expect(store.getState().fields.map((f) => f.required)).toEqual([
      true,
      true,
      true,
      undefined,
    ]);
  });
  it("does not create history for unsupported, invalid or unchanged values", () => {
    const store = create();
    for (const [key, value] of [
      ["fontSize", NaN],
      ["fontSize", 100],
      ["opacity", 50],
      ["horizontalAlignment", "middle"],
      ["horizontalAlignment", "left"],
      ["required", false],
    ] as const) {
      expect(store.getState().updateSelectedControlProperty(key, value)).toBe(
        false,
      );
    }
    expect(store.getState().past).toHaveLength(0);
    expect(store.getState().isDirty).toBe(false);
  });
  it("blocks signed controls and checks permission before any update or checkpoint", () => {
    const store = create({
      fields: [
        field("a"),
        field("b", { type: FieldType.SIGNATURE, signature: { present: true } }),
      ],
    });
    expect(
      store.getState().updateSelectedControlProperty("readOnly", true),
    ).toBe(false);
    expect(store.getState().past).toHaveLength(0);
    store.setState({
      fields: [field("a"), field("b")],
      documentPermissions: {
        ...UNRESTRICTED_PDF_PERMISSIONS,
        canModifyContents: false,
        canFillForms: false,
      },
    });
    expect(() =>
      store.getState().updateSelectedControlProperty("fontSize", 24),
    ).toThrow();
    expect(store.getState().past).toHaveLength(0);
    expect(store.getState().fields[0].style).toBeUndefined();
  });
  it("applies annotation font, alignment and appearance edits through existing edit metadata rules", () => {
    const annotations = [
      annotation("a", {
        fontFamily: "Courier",
        size: 10,
        sourcePdfRef: { objectNumber: 1, generationNumber: 0 },
      }),
      annotation("b", {
        size: 20,
        sourcePdfRef: { objectNumber: 2, generationNumber: 0 },
        sourcePdfFontMissing: true,
      }),
    ];
    const store = create({ mode: "annotation", fields: [], annotations });
    store
      .getState()
      .updateSelectedControlProperty("verticalAlignment", "middle");
    expect(
      store.getState().annotations.map((a) => a.verticalAlignment),
    ).toEqual(["middle", "middle"]);
    expect(store.getState().annotations[0].fontFamily).toBe("Courier");
    expect(store.getState().annotations[1].fontFamily).toBe("Helvetica");
    expect(
      store.getState().annotations.every((a) => a.isEdited && a.updatedAt),
    ).toBe(true);
    store.getState().undo();
    expect(store.getState().annotations).toEqual(annotations);
  });
  it("clears stale ink appearances and updates mixed annotation opacity together", () => {
    const store = create({
      mode: "annotation",
      fields: [],
      annotations: [
        annotation("a", { type: "shape", opacity: 0.2 }),
        annotation("b", {
          type: "ink",
          points: [
            { x: 10, y: 10 },
            { x: 40, y: 40 },
          ],
          appearanceStreamContent: "old",
          opacity: 0.8,
        }),
      ],
    });
    store.getState().updateSelectedControlProperty("opacity", 50);
    expect(store.getState().annotations.map((a) => a.opacity)).toEqual([
      0.5, 0.5,
    ]);
    expect(
      store.getState().annotations[1].appearanceStreamContent,
    ).toBeUndefined();
    expect(store.getState().past).toHaveLength(1);
    store.getState().updateSelectedControlProperty("thickness", 8);
    expect(store.getState().annotations.map((a) => a.thickness)).toEqual([
      8, 8,
    ]);
    expect(store.getState().annotations[1].rect?.width).toBeGreaterThan(30);
  });
  it("enables a chosen background and groups continuous color edits into one checkpoint", () => {
    const store = create({
      fields: [
        field("a", { style: { isTransparent: true } }),
        field("b", { style: { backgroundColor: "#ffffff" } }),
      ],
    });
    store
      .getState()
      .updateSelectedControlProperty("backgroundColor", "#ffffff");
    store
      .getState()
      .updateSelectedControlProperty("backgroundColor", "#ff0000", false);
    expect(
      store
        .getState()
        .fields.every(
          (f) =>
            f.style?.backgroundColor === "#ff0000" && !f.style.isTransparent,
        ),
    ).toBe(true);
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().fields[0].style?.isTransparent).toBe(true);
  });
});
