import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFStream,
  PDFString,
} from "@cantoo/pdf-lib";
import { exportPDF, loadPDF } from "@/services/pdfService";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { FreeTextExporter } from "@/services/pdfService/exporters/AnnotationExporters";
import {
  getOrderedExportControlsByPage,
  reorderExportedPageAnnotations,
} from "@/services/pdfService/lib/annotation-layer-order";
import { getOrderedPageControls } from "@/lib/controlLayerOrder";
import { FieldType, type Annotation, type FormField } from "@/types";
import { createTestEditorStore } from "../helpers/editorStore";

const sourceRef = (ref: PDFRef) => ({
  objectNumber: ref.objectNumber,
  generationNumber: ref.generationNumber,
});
const refsOnPage = (doc: PDFDocument, pageIndex = 0) => {
  const annots = doc.getPage(pageIndex).node.Annots();
  return annots
    ? Array.from({ length: annots.size() }, (_, i) => annots.get(i))
    : [];
};
const makeFixture = async (widgetCount = 1) => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  doc.addPage([300, 300]);
  const text = doc.getForm().createTextField("name");
  const fields: FormField[] = [];
  for (let i = 0; i < widgetCount; i++) {
    text.addToPage(page, { x: 20, y: 240 - i * 40, width: 120, height: 24 });
    const ref = text.acroField.Kids()!.get(i) as PDFRef;
    fields.push({
      id: `field-${i}`,
      name: "name",
      type: FieldType.TEXT,
      pageIndex: 0,
      layerOrder: i,
      rect: { x: 20, y: 36 + i * 40, width: 120, height: 24 },
      value: "Alice",
      style: { fontFamily: "Helvetica", fontSize: 12 },
      sourcePdfRef: sourceRef(ref),
    });
  }
  const apRef = doc.context.register(
    doc.context.flateStream("q\n0.2 0.4 0.8 rg\n0 0 80 30 re\nf\nQ\n", {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 80, 30],
      Resources: {},
    }),
  );
  const root = doc.context.obj({
    Type: "Annot",
    Subtype: "FreeText",
    Rect: [20, 120, 100, 150],
    P: page.ref,
    F: 4,
    Contents: PDFHexString.fromText("中文原始外观"),
    DA: PDFString.of("/Source 12 Tf 0 g"),
    AP: { N: apRef },
    OriginalMarker: PDFString.of("keep-me"),
  });
  const rootRef = doc.context.register(root);
  page.node.addAnnot(rootRef);
  const replyRef = doc.context.register(
    doc.context.obj({
      Type: "Annot",
      Subtype: "Text",
      Rect: [100, 120, 124, 144],
      P: page.ref,
      IRT: rootRef,
      RT: "R",
      Contents: PDFString.of("Original reply"),
      F: 4,
    }),
  );
  page.node.addAnnot(replyRef);
  const popupRef = doc.context.register(
    doc.context.obj({
      Type: "Annot",
      Subtype: "Popup",
      Rect: [120, 100, 220, 160],
      Parent: rootRef,
      P: page.ref,
    }),
  );
  root.set(PDFName.of("Popup"), popupRef);
  page.node.addAnnot(popupRef);
  const annotation: Annotation = {
    id: "original",
    type: "freetext",
    pageIndex: 0,
    layerOrder: widgetCount,
    rect: { x: 20, y: 150, width: 80, height: 30 },
    text: "中文原始外观",
    fontFamily: "Noto Sans SC",
    sourcePdfRef: sourceRef(rootRef),
    isEdited: false,
    replies: [
      {
        id: "reply",
        parentAnnotationId: "original",
        text: "Original reply",
        sourcePdfRef: sourceRef(replyRef),
        isEdited: false,
      },
    ],
  };
  return { doc, fields, annotation, rootRef, replyRef, popupRef, apRef, text };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("reuse source annotation appearances on form pages", () => {
  it("imports the raw mixed Ink/widget/FreeText order instead of filtered parser indexes", async () => {
    const { doc, rootRef } = await makeFixture();
    const page = doc.getPage(0);
    const inkRef = doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Ink",
        Rect: [10, 10, 40, 40],
        InkList: [[10, 10, 40, 40]],
        C: [0, 0, 0],
        BS: { W: 1 },
        P: page.ref,
      }),
    );
    page.node.Annots()!.insert(0, inkRef);
    const result = await loadPDF(await doc.save(), {
      workerService: {
        loadDocument: async () => true,
        getOutline: async () => [],
        getPermissions: async () => null,
        resolveDest: async () => null,
      } as unknown as PDFWorkerService,
    });
    try {
      expect(result.fields[0].layerOrder).toBe(1);
      expect(
        result.annotations.find(
          (annotation) =>
            annotation.sourcePdfRef?.objectNumber === inkRef.objectNumber,
        )?.layerOrder,
      ).toBe(0);
      expect(
        result.annotations.find(
          (annotation) =>
            annotation.sourcePdfRef?.objectNumber === rootRef.objectNumber,
        )?.layerOrder,
      ).toBe(2);
    } finally {
      result.dispose();
    }
  });

  it("does not infer an annotation-only reorder when no layer orders were provided", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const first = doc.context.register(doc.context.obj({ Subtype: "Square" }));
    const second = doc.context.register(doc.context.obj({ Subtype: "Circle" }));
    page.node.set(PDFName.of("Annots"), doc.context.obj([first, second]));
    const controls = getOrderedPageControls(
      [],
      [
        { id: "second", type: "shape", pageIndex: 0 },
        { id: "first", type: "shape", pageIndex: 0 },
      ],
      0,
    );
    expect(
      reorderExportedPageAnnotations(
        page,
        controls,
        new Map([
          ["first", first],
          ["second", second],
        ]),
      ),
    ).toBe(0);
    expect(refsOnPage(doc)).toEqual([first, second]);
  });
  it.each([false, true])(
    "preserves source AP, metadata, popup and reply without font fallback (print=%s)",
    async (flattenFormFields) => {
      const fixture = await makeFixture();
      const bytes = await fixture.doc.save();
      const save = vi.spyOn(FreeTextExporter.prototype, "save");
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const output = await exportPDF(
        bytes,
        fixture.fields,
        undefined,
        [fixture.annotation],
        undefined,
        { flattenFormFields },
      );
      expect(save).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      const reopened = await PDFDocument.load(output);
      const root = reopened.context.lookup(fixture.rootRef, PDFDict);
      expect(
        root.lookup(PDFName.of("AP"), PDFDict).get(PDFName.of("N")),
      ).toEqual(fixture.apRef);
      expect(
        root.lookup(PDFName.of("OriginalMarker"), PDFString).decodeText(),
      ).toBe("keep-me");
      expect(refsOnPage(reopened)).toEqual(
        expect.arrayContaining([
          fixture.rootRef,
          fixture.replyRef,
          fixture.popupRef,
        ]),
      );
      expect(
        reopened.context
          .lookup(fixture.replyRef, PDFDict)
          .get(PDFName.of("IRT")),
      ).toEqual(fixture.rootRef);
      if (flattenFormFields)
        expect(reopened.getForm().getFields()).toHaveLength(0);
      else
        expect(reopened.getForm().getTextField("name").getText()).toBe("Alice");
    },
  );

  it("orders retained widgets, retained annotations and new annotations together", async () => {
    const { doc, fields, annotation, rootRef, replyRef, popupRef } =
      await makeFixture();
    const unknown = doc.context.register(
      doc.context.obj({ Type: "Annot", Subtype: "Caret", Rect: [0, 0, 1, 1] }),
    );
    const array = doc.getPage(0).node.Annots()!;
    array.insert(1, unknown);
    const output = await exportPDF(
      await doc.save(),
      [{ ...fields[0], layerOrder: 2 }],
      undefined,
      [
        { ...annotation, layerOrder: 0 },
        {
          id: "new",
          type: "shape",
          shapeType: "square",
          pageIndex: 0,
          layerOrder: 1,
          rect: { x: 60, y: 60, width: 50, height: 30 },
          color: "#00ff00",
          thickness: 1,
        },
      ],
    );
    const reopened = await PDFDocument.load(output);
    const refs = refsOnPage(reopened);
    const widget = PDFRef.of(
      fields[0].sourcePdfRef!.objectNumber,
      fields[0].sourcePdfRef!.generationNumber,
    );
    expect(refs[0]).toEqual(rootRef);
    expect(refs[1]).toEqual(unknown);
    expect(refs[3]).toEqual(replyRef);
    expect(refs[4]).toEqual(popupRef);
    expect(refs.at(-1)).toEqual(widget);
    expect(
      reopened.context
        .lookup(refs[2] as PDFRef, PDFDict)
        .get(PDFName.of("Subtype")),
    ).toBe(PDFName.of("Square"));
    expect(refs).toHaveLength(6);
  });

  it("keeps individual shared-field widgets on their requested layers", async () => {
    const { doc, fields, annotation, rootRef } = await makeFixture(2);
    const output = await exportPDF(
      await doc.save(),
      [
        { ...fields[0], layerOrder: 2 },
        { ...fields[1], layerOrder: 0 },
      ],
      undefined,
      [{ ...annotation, layerOrder: 1 }],
    );
    const refs = refsOnPage(await PDFDocument.load(output));
    expect(refs.slice(0, 3)).toEqual([
      PDFRef.of(fields[1].sourcePdfRef!.objectNumber, 0),
      rootRef,
      PDFRef.of(fields[0].sourcePdfRef!.objectNumber, 0),
    ]);
  });

  it("supports parent-field references without losing any widgets", async () => {
    const { doc, fields, annotation, rootRef, text } = await makeFixture(2);
    const output = await exportPDF(
      await doc.save(),
      [{ ...fields[0], layerOrder: 2, sourcePdfRef: sourceRef(text.ref) }],
      undefined,
      [{ ...annotation, layerOrder: 0 }],
    );
    const reopened = await PDFDocument.load(output);
    expect(refsOnPage(reopened)[0]).toEqual(rootRef);
    expect(
      reopened.getForm().getTextField("name").acroField.getWidgets(),
    ).toHaveLength(2);
  });

  it("regenerates an edited reply but not its unchanged parent", async () => {
    const { doc, fields, annotation, rootRef, replyRef } = await makeFixture();
    const save = vi.spyOn(FreeTextExporter.prototype, "save");
    const output = await exportPDF(await doc.save(), fields, undefined, [
      {
        ...annotation,
        replies: [
          { ...annotation.replies![0], text: "Changed reply", isEdited: true },
        ],
      },
    ]);
    expect(save).not.toHaveBeenCalled();
    const reopened = await PDFDocument.load(output);
    expect(refsOnPage(reopened)).not.toContainEqual(replyRef);
    const reply = refsOnPage(reopened)
      .map((ref) => reopened.context.lookup(ref))
      .find(
        (obj) =>
          obj instanceof PDFDict && obj.get(PDFName.of("IRT")) === rootRef,
      ) as PDFDict;
    expect(
      reply.lookup(PDFName.of("Contents"), PDFHexString).decodeText(),
    ).toBe("Changed reply");
  });

  it("retargets replies when the edited parent gets a new reference", async () => {
    const { doc, fields, annotation, rootRef } = await makeFixture();
    const save = vi.spyOn(FreeTextExporter.prototype, "save");
    const output = await exportPDF(await doc.save(), fields, undefined, [
      {
        ...annotation,
        text: "Edited",
        fontFamily: "Helvetica",
        isEdited: true,
      },
    ]);
    expect(save).toHaveBeenCalledTimes(1);
    const reopened = await PDFDocument.load(output);
    const refs = refsOnPage(reopened);
    expect(refs).not.toContainEqual(rootRef);
    const parent = refs.find(
      (ref) =>
        reopened.context.lookup(ref, PDFDict).get(PDFName.of("Subtype")) ===
        PDFName.of("FreeText"),
    );
    const reply = refs
      .map((ref) => reopened.context.lookup(ref, PDFDict))
      .find((dict) => dict.get(PDFName.of("IRT")) === parent);
    expect(reply).toBeDefined();
  });

  it("does not preserve an annotation explicitly requested as flattened", async () => {
    const { doc, fields, annotation, rootRef, replyRef } = await makeFixture();
    const output = await exportPDF(await doc.save(), fields, undefined, [
      { ...annotation, text: "Flat", fontFamily: "Helvetica", flatten: true },
    ]);
    const reopened = await PDFDocument.load(output);
    const refs = refsOnPage(reopened);
    expect(refs).not.toContainEqual(rootRef);
    expect(refs).not.toContainEqual(replyRef);
    const contents = reopened.getPage(0).node.Contents();
    expect(
      contents instanceof PDFArray
        ? contents.size() > 0
        : contents instanceof PDFStream,
    ).toBe(true);
  });

  it("does not touch an excluded page or load fonts for its annotations", async () => {
    const { doc, fields, annotation } = await makeFixture();
    const save = vi.spyOn(FreeTextExporter.prototype, "save");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const output = await exportPDF(
      await doc.save(),
      fields,
      undefined,
      [annotation],
      undefined,
      { pageIndexes: [1] },
    );
    const reopened = await PDFDocument.load(output);
    expect(reopened.getPageCount()).toBe(1);
    expect(refsOnPage(reopened)).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves unmanaged entries and duplicate reference multiplicity while sorting", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const first = doc.context.register(doc.context.obj({ Subtype: "Square" }));
    const second = doc.context.register(doc.context.obj({ Subtype: "Circle" }));
    const direct = doc.context.obj({ Subtype: "Popup" });
    page.node.set(
      PDFName.of("Annots"),
      doc.context.obj([first, direct, second, first]),
    );
    const annotations: Annotation[] = [
      { id: "second", pageIndex: 0, type: "shape", layerOrder: 0 },
      { id: "first", pageIndex: 0, type: "shape", layerOrder: 1 },
    ];
    const controls = getOrderedPageControls([], annotations, 0);
    const map = new Map([
      ["first", first],
      ["second", second],
    ]);
    expect(reorderExportedPageAnnotations(page, controls, map)).toBe(2);
    expect(refsOnPage(doc)).toEqual([second, direct, first, first]);
    expect(reorderExportedPageAnnotations(page, controls, map)).toBe(0);
  });

  it("page bucketing retains the shared layer-order semantics", () => {
    const fields: FormField[] = Array.from({ length: 20 }, (_, i) => ({
      id: `f${i}`,
      name: `f${i}`,
      type: FieldType.TEXT,
      pageIndex: i % 3,
      layerOrder: i % 2 ? i : undefined,
      rect: { x: 0, y: 0, width: 1, height: 1 },
    }));
    const annotations: Annotation[] = Array.from({ length: 20 }, (_, i) => ({
      id: `a${i}`,
      type: "comment",
      pageIndex: i % 3,
      layerOrder: i % 2 ? i : undefined,
    }));
    const grouped = getOrderedExportControlsByPage(fields, annotations);
    for (let page = 0; page < 3; page++)
      expect(grouped.get(page)).toEqual(
        getOrderedPageControls(fields, annotations, page),
      );
  });
});

describe("layer-only edits do not dirty source appearances", () => {
  it("keeps annotation/reply content flags and timestamps, with undo/redo", () => {
    const annotation: Annotation = {
      id: "a",
      type: "comment",
      pageIndex: 0,
      layerOrder: 1,
      sourcePdfRef: { objectNumber: 10, generationNumber: 0 },
      isEdited: false,
      updatedAt: "2026-01-01T00:00:00Z",
      replies: [
        { id: "r", parentAnnotationId: "a", text: "Reply", isEdited: false },
      ],
    };
    const field: FormField = {
      id: "f",
      name: "f",
      type: FieldType.TEXT,
      pageIndex: 0,
      layerOrder: 0,
      rect: { x: 0, y: 0, width: 10, height: 10 },
    };
    const store = createTestEditorStore({
      fields: [field],
      annotations: [annotation],
    });
    store.getState().reorderControlLayer("f", "bring_to_front");
    expect(store.getState().annotations[0]).toMatchObject({
      ...annotation,
      layerOrder: 0,
    });
    expect(store.getState().fields[0].layerOrder).toBe(1);
    expect(store.getState().isDirty).toBe(true);
    store.getState().undo();
    expect(store.getState().annotations[0]).toEqual(annotation);
    store.getState().redo();
    expect(store.getState().annotations[0]).toMatchObject({
      ...annotation,
      layerOrder: 0,
    });
  });
});
