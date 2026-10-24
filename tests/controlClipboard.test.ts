import { afterEach, describe, expect, it } from "vitest";
import {
  CONTROL_CLIPBOARD_MIME,
  copySelectedControl,
  readControlClipboard,
  writeControlClipboard,
} from "@/lib/controlClipboard";
import {
  PdfPermissionDeniedError,
  UNRESTRICTED_PDF_PERMISSIONS,
} from "@/lib/pdfPermissions";
import { getInkRenderPath } from "@/lib/inkGeometry";
import { FieldType, type Annotation } from "@/types";
import { createTestEditorStore, field, page } from "./helpers/editorStore";

const stores: ReturnType<typeof createTestEditorStore>[] = [];
const createStore = (
  state: Parameters<typeof createTestEditorStore>[0] = {},
) => {
  const store = createTestEditorStore(state);
  stores.push(store);
  return store;
};
afterEach(() => stores.splice(0).forEach((store) => store.dispose()));

const clipboard = () => {
  const values = new Map<string, string>();
  return {
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => values.set(type, value),
    clearData: (type: string) => values.delete(type),
  } as unknown as DataTransfer;
};
const copy = (store: ReturnType<typeof createStore>) => {
  const data = clipboard();
  const control = copySelectedControl(store.getState());
  expect(control).not.toBeNull();
  writeControlClipboard(data, control!);
  return data;
};

describe("control clipboard across documents", () => {
  it.each(Object.values(FieldType))(
    "copies %s independently, avoids name collisions and supports undo/redo",
    (type) => {
      const original = field("original", {
        type,
        name: "name",
        value: "filled",
        defaultValue: "default",
        required: true,
        readOnly: true,
        isChecked: true,
        isDefaultChecked: true,
        options: ["filled", "other"],
        radioValue: "yes",
        exportValue: "yes",
        signatureData: "data:image/png;base64,c2lnbmF0dXJl",
        style: { fontSize: 18, textColor: "#ff0000" },
        sourcePdfRef: { objectNumber: 6, generationNumber: 0 },
      });
      const source = createStore({
        fields: [original],
        selectedId: original.id,
      });
      const target = createStore({
        fields: [
          field("existing", { name: "name" }),
          field("existing2", { name: "name_1" }),
        ],
        pages: [page(0), page(1)],
        currentPageIndex: 1,
      });
      const data = copy(source);
      source.getState().updateField(original.id, {
        value: "later edit",
        style: { fontSize: 30 },
      });
      source.dispose();
      // Simulate an OS/WebView that only preserves the plain-text representation.
      data.clearData(CONTROL_CLIPBOARD_MIME);
      const payload = readControlClipboard(data)!;
      expect(target.getState().pasteControl(payload)).toBe(true);
      const pasted = target.getState().fields.at(-1)!;
      expect(pasted).toMatchObject({
        type,
        name: "name_2",
        pageIndex: 1,
        value: "filled",
        defaultValue: "default",
        required: true,
        readOnly: true,
        isChecked: true,
        isDefaultChecked: true,
        style: { fontSize: 18, textColor: "#ff0000" },
        rect: { x: 22, y: 22, width: 100, height: 20 },
      });
      expect(pasted.id).not.toBe(original.id);
      expect(pasted.sourcePdfRef).toBeUndefined();
      expect(target.getState()).toMatchObject({
        selectedId: pasted.id,
        mode: "form",
        tool: "select",
        isDirty: true,
        dirtyPermissionScopes: { modifyContents: true },
      });
      expect(target.getState().past).toHaveLength(1);
      target.getState().undo();
      expect(target.getState().fields).toHaveLength(2);
      target.getState().redo();
      expect(target.getState().fields.at(-1)).toEqual(pasted);
      target.getState().pasteControl(payload);
      expect(target.getState().fields.at(-1)!.name).toBe("name_3");
      expect(target.getState().fields.at(-1)!.id).not.toBe(pasted.id);
    },
  );

  it.each([
    "highlight",
    "ink",
    "comment",
    "freetext",
    "shape",
    "stamp",
    "link",
  ] as const)(
    "copies %s geometry, images and nested replies without source references",
    (type) => {
      const annotation: Annotation = {
        id: "annotation",
        type,
        pageIndex: 0,
        rect: { x: 40, y: 50, width: 60, height: 20 },
        rects: [
          { x: 40, y: 50, width: 25, height: 8 },
          { x: 40, y: 62, width: 60, height: 8 },
        ],
        strokes: [
          [
            { x: 40, y: 50 },
            { x: 100, y: 70 },
          ],
        ],
        thickness: 2,
        shapePoints: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        shapeType: "line",
        text: "review",
        fontFamily: "Helvetica",
        color: "#ee0000",
        linkUrl: "https://example.com",
        linkDestPageIndex: 4,
        sourcePdfRef: { objectNumber: 50, generationNumber: 0 },
        sourcePdfFontName: "ABCDE+Font",
        appearanceStreamContent: "source operators",
        stamp: {
          kind: "image",
          image: { dataUrl: "data:image/png;base64,aW1hZ2U=" },
          appearance: { scaleMode: "fill", source: "baked" },
        },
        replies: [
          {
            id: "reply",
            parentAnnotationId: "annotation",
            text: "first",
            sourcePdfRef: { objectNumber: 51, generationNumber: 0 },
          },
          {
            id: "nested",
            parentAnnotationId: "annotation",
            inReplyToReplyId: "reply",
            text: "second",
          },
        ],
      };
      const source = createStore({
        annotations: [annotation],
        selectedId: annotation.id,
      });
      const target = createStore({
        pages: [page(0), page(1)],
        currentPageIndex: 1,
        mode: "form",
      });
      const payload = readControlClipboard(copy(source))!;
      target.getState().pasteControl(payload);
      const result = target.getState().annotations[0];
      expect(result).toMatchObject({
        type,
        pageIndex: 1,
        text: "review",
        stamp: annotation.stamp,
        shapePoints: annotation.shapePoints,
        linkUrl: annotation.linkUrl,
      });
      expect(result.sourcePdfRef).toBeUndefined();
      expect(result.sourcePdfFontName).toBeUndefined();
      expect(result.appearanceStreamContent).toBeUndefined();
      expect(result.linkDestPageIndex).toBeUndefined();
      expect(result.replies![0].sourcePdfRef).toBeUndefined();
      expect(result.replies![0].parentAnnotationId).toBe(result.id);
      expect(result.replies![1].inReplyToReplyId).toBe(result.replies![0].id);
      expect(result.replies![0].id).not.toBe("reply");
      if (type === "ink") {
        expect(result.strokes![0]).toEqual([
          { x: 52, y: 62 },
          { x: 112, y: 82 },
        ]);
        expect(getInkRenderPath(result).d).toBeTruthy();
        expect(result.rect).toMatchObject({ x: 51, y: 61 });
      } else {
        expect(result.rect).toMatchObject({ x: 52, y: 62 });
      }
      if (type === "highlight")
        expect(result.rects![1]).toMatchObject({ x: 52, y: 74 });
      expect(target.getState().past).toHaveLength(1);
      expect(target.getState()).toMatchObject({
        mode: "annotation",
        dirtyPermissionScopes: { modifyAnnotations: true },
      });
      target.getState().undo();
      expect(target.getState().annotations).toHaveLength(0);
      target.getState().redo();
      expect(target.getState().annotations[0]).toEqual(result);
      // A menu target belongs to its clicked page, regardless of the active page.
      target
        .getState()
        .pasteControl(payload, { pageId: "original:0", x: 240, y: 300 });
      const placed = target.getState().annotations.at(-1)!;
      expect(placed.pageIndex).toBe(0);
      expect(placed.rect).toMatchObject({ x: 240, y: 300 });
      if (type === "ink")
        expect(placed.strokes![0]).toEqual([
          { x: 241, y: 301 },
          { x: 301, y: 321 },
        ]);
      if (type === "highlight")
        expect(placed.rects![1]).toMatchObject({ x: 240, y: 312 });
      expect(placed.shapePoints).toEqual(annotation.shapePoints);
      expect(payload.data.rect).not.toEqual(placed.rect);
    },
  );

  it("positions form controls by page identity, clamps edges, and rejects missing pages", () => {
    const source = createStore({ fields: [field()], selectedId: "field-1" });
    const payload = copySelectedControl(source.getState())!;
    const target = createStore({
      pages: [page(0), { ...page(1), id: "stable-page" }],
    });
    expect(
      target
        .getState()
        .pasteControl(payload, { pageId: "stable-page", x: 250, y: 350 }),
    ).toBe(true);
    expect(target.getState().fields[0]).toMatchObject({
      pageIndex: 1,
      rect: { x: 250, y: 350 },
    });
    target
      .getState()
      .pasteControl(payload, { pageId: "stable-page", x: 590, y: 795 });
    expect(target.getState().fields[1].rect).toMatchObject({ x: 500, y: 780 });
    const before = target.getState();
    expect(
      target
        .getState()
        .pasteControl(payload, { pageId: "deleted", x: 10, y: 20 }),
    ).toBe(false);
    expect(
      target
        .getState()
        .pasteControl(payload, { pageId: "stable-page", x: NaN, y: 20 }),
    ).toBe(false);
    expect(target.getState().past).toBe(before.past);
    target.getState().pasteControl(payload);
    expect(target.getState().fields.at(-1)).toMatchObject({
      pageIndex: 0,
      rect: { x: 22, y: 22 },
    });
  });

  it("clamps copies to smaller pages and retains internal links only in their source document", () => {
    const annotation: Annotation = {
      id: "link",
      type: "link",
      pageIndex: 0,
      rect: { x: 500, y: 700, width: 50, height: 20 },
      linkDestPageIndex: 0,
    };
    const source = createStore({
      annotations: [annotation],
      selectedId: "link",
    });
    const payload = readControlClipboard(copy(source))!;
    source.getState().pasteControl(payload);
    expect(source.getState().annotations.at(-1)!.linkDestPageIndex).toBe(0);
    const target = createStore({
      pages: [{ ...page(), width: 200, height: 100 }],
    });
    target.getState().pasteControl(payload);
    expect(target.getState().annotations[0].rect).toEqual({
      x: 150,
      y: 80,
      width: 50,
      height: 20,
    });
  });

  it("enforces source copy and destination editing permissions without history changes", () => {
    const source = createStore({ fields: [field()], selectedId: "field-1" });
    const payload = readControlClipboard(copy(source))!;
    source.setState({
      documentPermissions: { ...UNRESTRICTED_PDF_PERMISSIONS, canCopy: false },
    });
    expect(() => copySelectedControl(source.getState())).toThrow(
      PdfPermissionDeniedError,
    );
    const target = createStore({
      documentPermissions: {
        ...UNRESTRICTED_PDF_PERMISSIONS,
        canModifyContents: false,
        canFillForms: true,
      },
    });
    expect(() => target.getState().pasteControl(payload)).toThrow(
      PdfPermissionDeniedError,
    );
    expect(target.getState().fields).toHaveLength(0);
    expect(target.getState().past).toHaveLength(0);
    expect(target.getState().isDirty).toBe(false);
    target.setState({ mode: "pages" });
    expect(target.getState().pasteControl(payload)).toBe(false);
  });

  it("ignores ordinary clipboard text and rejects corrupt control geometry", () => {
    const data = clipboard();
    data.setData("text/plain", "ordinary text");
    expect(readControlClipboard(data)).toBeNull();
    data.setData(CONTROL_CLIPBOARD_MIME, "not json");
    expect(readControlClipboard(data)).toBeNull();
    const payload = {
      version: 1,
      sourceDocumentId: "source",
      type: "field",
      data: field(),
    };
    for (const invalid of [
      { ...payload, version: 2 },
      {
        ...payload,
        data: {
          ...payload.data,
          rect: { x: "bad", y: 0, width: 20, height: 20 },
        },
      },
      { ...payload, data: { ...payload.data, options: [null] } },
      {
        ...payload,
        data: { ...payload.data, signatureData: "blob:source-only" },
      },
    ]) {
      data.setData(CONTROL_CLIPBOARD_MIME, JSON.stringify(invalid));
      expect(readControlClipboard(data)).toBeNull();
    }
  });

  it("uses plain text when custom clipboard formats are unavailable", () => {
    const data = clipboard();
    const native = {
      getData: (type: string) => {
        if (type !== "text/plain")
          throw new Error("Unsupported clipboard format");
        return data.getData(type);
      },
      setData: (type: string, value: string) => {
        if (type !== "text/plain")
          throw new Error("Unsupported clipboard format");
        data.setData(type, value);
      },
    } as DataTransfer;
    const source = createStore({ fields: [field()], selectedId: "field-1" });
    const control = copySelectedControl(source.getState())!;
    writeControlClipboard(native, control);
    expect(readControlClipboard(native)).toEqual(control);
  });
});
