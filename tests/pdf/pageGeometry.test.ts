import { describe, expect, it } from "vitest";
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFArray,
  degrees,
  StandardFonts,
} from "@legir/pdfium/authoring";
import { exportPDF, loadPDF } from "@/services/pdfService";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { createEditorView } from "@/store/editorView";
import { getPageId } from "@legir/pdf-core/lib/pageStructure";
import {
  getEditedPage,
  resizePageGeometry,
  cropPageGeometry,
} from "@legir/pdf-model/pageGeometry";
import {
  getPageView,
  pagePointToView,
  viewPointToPage,
} from "@/components/workspace/lib/pageViewRotation";
import { UNRESTRICTED_PDF_PERMISSIONS } from "@legir/pdf-model/pdfPermissions";

const worker = {
  loadDocument: async () => true,
  getOutline: async () => [],
  getPermissions: async () => null,
  resolveDest: async () => null,
} as unknown as PDFWorkerService;
async function fixture(rotation = 0) {
  const doc = await PDFDocument.create(),
    page = doc.addPage([600, 800]);
  page.setCropBox(30, 40, 500, 700);
  page.setTrimBox(0, 0, 600, 800);
  page.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
  page.setRotation(degrees(rotation));
  page.drawText("Selectable source text", {
    x: 100,
    y: 500,
    size: 24,
    font: await doc.embedFont(StandardFonts.Helvetica),
  });
  doc
    .getForm()
    .createTextField("field")
    .addToPage(page, { x: 100, y: 200, width: 120, height: 30 });
  doc.getForm().getTextField("field").setText("Editable");
  doc.addPage([300, 400]);
  doc.getPage(1).node.addAnnot(
    doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [10, 10, 80, 30],
        Dest: [page.ref, "XYZ", 100, 500, null],
      }),
    ),
  );
  const loaded = await loadPDF(await doc.save(), { workerService: worker });
  const store = createEditorView({ state: loaded });
  return { store, loaded };
}
async function save(store: ReturnType<typeof createEditorView>) {
  const s = store.getState();
  return exportPDF(
    s.pdfBytes!,
    s.fields,
    s.metadata,
    s.annotations,
    undefined,
    {
      pageStructure: { pages: s.pages, sources: s.pageSources },
      syncFormFields: true,
      preservedSourceAnnotations: s.preservedSourceAnnotations,
    },
  );
}
describe("page size and cropping", () => {
  it.each([0, 90, 180, 270])(
    "round-trips resized and cropped editable pages with source rotation %i",
    async (rotation) => {
      const { store, loaded } = await fixture(rotation);
      try {
        const id = getPageId(store.getState().pages[0]),
          originalField = store.getState().fields[0];
        store.getState().rotatePages([id], 90);
        store.getState().resizePages([id], {
          width: 420,
          height: 600,
          content: "fit",
          anchorX: 0.5,
          anchorY: 0.5,
        });
        expect(getPageView(store.getState().pages[0], 0)).toMatchObject({
          width: 420,
          height: 600,
        });
        store
          .getState()
          .cropPages([id], { top: 10, right: 20, bottom: 30, left: 40 });
        const page = store.getState().pages[0];
        expect(getPageView(page, 0).width).toBeCloseTo(360);
        expect(getPageView(page, 0).height).toBeCloseTo(560);
        expect(store.getState().fields[0]).toEqual(originalField);
        const saved = await save(store),
          reopened = await loadPDF(saved, { workerService: worker });
        try {
          expect(reopened.pages[0].width).toBeCloseTo(360, 3);
          expect(reopened.pages[0].height).toBeCloseTo(560, 3);
          const a = pagePointToView(originalField.rect, page, 0);
          const b = pagePointToView(
            {
              x: originalField.rect.x + originalField.rect.width,
              y: originalField.rect.y + originalField.rect.height,
            },
            page,
            0,
          );
          expect(reopened.fields[0].rect.x).toBeCloseTo(Math.min(a.x, b.x), 2);
          expect(reopened.fields[0].rect.y).toBeCloseTo(Math.min(a.y, b.y), 2);
          expect(reopened.fields[0].rect.width).toBeCloseTo(
            Math.abs(b.x - a.x),
            2,
          );
          expect(reopened.fields[0].rect.height).toBeCloseTo(
            Math.abs(b.y - a.y),
            2,
          );
          expect(reopened.fields[0].value).toBe("Editable");
          expect(reopened.fields[0].style?.fontSize).toBeCloseTo(
            originalField.style!.fontSize! * page.geometry!.scale,
            3,
          );
          const output = await PDFDocument.load(saved);
          expect(
            output
              .getPage(0)
              .node.lookup(PDFName.of("UserUnit"), PDFNumber)
              .asNumber(),
          ).toBe(2);
          expect(output.getForm().getTextField("field").getText()).toBe(
            "Editable",
          );
          expect(output.getPage(0).getMediaBox().width).toBeGreaterThan(
            output.getPage(0).getCropBox().width,
          );
          const media = output.getPage(0).getMediaBox(),
            trim = output
              .getPage(0)
              .node.lookup(PDFName.of("TrimBox"), PDFArray)
              .asArray()
              .map((n) => (n as PDFNumber).asNumber());
          expect(trim[0]).toBeGreaterThanOrEqual(media.x);
          expect(trim[1]).toBeGreaterThanOrEqual(media.y);
          expect(trim[2]).toBeLessThanOrEqual(media.x + media.width + 1e-6);
          expect(trim[3]).toBeLessThanOrEqual(media.y + media.height + 1e-6);
          expect(output.getPage(1).getSize()).toEqual({
            width: 300,
            height: 400,
          });
          const restored = createEditorView({ state: reopened });
          try {
            restored
              .getState()
              .resetPageCrop([getPageId(restored.getState().pages[0])]);
            const view = getPageView(restored.getState().pages[0], 0);
            expect(view.width).toBeCloseTo(420, 3);
            expect(view.height).toBeCloseTo(600, 3);
            const restoredPdf = await loadPDF(await save(restored), {
              workerService: worker,
            });
            try {
              expect(restoredPdf.pages[0].width).toBeCloseTo(420, 3);
              expect(restoredPdf.pages[0].height).toBeCloseTo(600, 3);
              expect(restoredPdf.fields[0].value).toBe("Editable");
            } finally {
              restoredPdf.dispose();
            }
          } finally {
            restored.dispose();
          }
        } finally {
          reopened.dispose();
        }
        const point = { x: 137, y: 285 };
        for (const viewRotation of [0, 90, 180, 270]) {
          const roundtrip = viewPointToPage(
            pagePointToView(point, page, viewRotation),
            page,
            viewRotation,
          );
          expect(roundtrip.x).toBeCloseTo(point.x, 8);
          expect(roundtrip.y).toBeCloseTo(point.y, 8);
        }
      } finally {
        store.dispose();
        loaded.dispose();
      }
    },
  );
  it("crops without a page-tree edit and resets through atomic history", async () => {
    const { store, loaded } = await fixture();
    try {
      const original = store.getState(),
        ids = original.pages.map(getPageId);
      store
        .getState()
        .cropPages(ids, { top: 10, right: 10, bottom: 10, left: 10 });
      const cropped = store.getState();
      expect(cropped.past.length).toBe(original.past.length + 1);
      expect(cropped.dirtyPermissionScopes.modifyContents).toBe(true);
      const reopened = await loadPDF(await save(store), {
        workerService: worker,
      });
      expect(reopened.pages[0].width).toBeCloseTo(980);
      expect(reopened.pages[1].width).toBeCloseTo(280);
      const restored = createEditorView({ state: reopened });
      restored
        .getState()
        .resetPageCrop(restored.getState().pages.map(getPageId));
      expect(getPageView(restored.getState().pages[0], 0)).toMatchObject({
        width: 1200,
        height: 1600,
      });
      expect(getPageView(restored.getState().pages[1], 0)).toMatchObject({
        width: 300,
        height: 400,
      });
      restored.dispose();
      reopened.dispose();
      store.getState().undo();
      expect(store.getState().pages).toBe(original.pages);
      store.getState().redo();
      expect(store.getState().pages).toBe(cropped.pages);
      store.getState().resetPageCrop(ids);
      expect(getPageView(store.getState().pages[0], 0)).toMatchObject({
        width: 1200,
        height: 1600,
      });
      expect(store.getState().pages[1].geometry).toBeUndefined();
      store.getState().undo();
      expect(store.getState().pages).toBe(cropped.pages);
      expect(() =>
        store
          .getState()
          .cropPages(ids, { top: 0, right: 0, bottom: 0, left: 900 }),
      ).toThrow();
      expect(store.getState().pages).toBe(cropped.pages);
    } finally {
      store.dispose();
      loaded.dispose();
    }
  });
  it("resets the paper and crops again in one undoable batch", async () => {
    const { store, loaded } = await fixture();
    try {
      const ids = store.getState().pages.map(getPageId);
      store
        .getState()
        .cropPages(ids, { top: 10, right: 10, bottom: 10, left: 10 });
      const before = store.getState();
      store
        .getState()
        .cropPages(
          ids,
          { top: 20, right: 30, bottom: 40, left: 50 },
          { reset: true },
        );
      const after = store.getState();
      expect(after.past.length).toBe(before.past.length + 1);
      expect(getPageView(after.pages[0], 0)).toMatchObject({
        width: 1120,
        height: 1540,
      });
      expect(getPageView(after.pages[1], 0)).toMatchObject({
        width: 220,
        height: 340,
      });
      store.getState().undo();
      expect(store.getState().pages).toBe(before.pages);
      store.getState().redo();
      expect(store.getState().pages).toBe(after.pages);
      const beforeInvalidCrop = store.getState();
      expect(() =>
        store
          .getState()
          .cropPages(
            ids,
            { top: 0, right: 0, bottom: 0, left: 1000 },
            { reset: true },
          ),
      ).toThrow();
      expect(store.getState()).toBe(beforeInvalidCrop);
    } finally {
      store.dispose();
      loaded.dispose();
    }
  });
  it("preserves editable annotation styles and destination coordinates after scaling", async () => {
    const { store, loaded } = await fixture();
    try {
      const id = getPageId(store.getState().pages[0]);
      store.setState({
        annotations: [
          ...store.getState().annotations,
          {
            id: "note",
            type: "freetext",
            pageIndex: 0,
            rect: { x: 200, y: 200, width: 240, height: 80 },
            text: "Scaled note",
            size: 20,
            fontFamily: "Helvetica",
            color: "#ff0000",
            borderWidth: 2,
            borderColor: "#000000",
            textPadding: { top: 4, right: 4, bottom: 4, left: 4 },
          },
          {
            id: "ink",
            type: "ink",
            pageIndex: 0,
            rect: { x: 200, y: 400, width: 100, height: 40 },
            points: [
              { x: 200, y: 400 },
              { x: 300, y: 440 },
            ],
            color: "#0000ff",
            thickness: 4,
          },
        ],
      });
      store.getState().resizePages([id], {
        width: 500,
        height: 700,
        content: "fit",
        anchorX: 0,
        anchorY: 0,
      });
      const result = await save(store),
        reopened = await loadPDF(result, { workerService: worker });
      try {
        const note = reopened.annotations.find((a) => a.type === "freetext")!;
        expect(note.text).toBe("Scaled note");
        expect(note.size).toBeCloseTo(10, 2);
        expect(note.rect!.x).toBeCloseTo(100, 2);
        expect(note.borderWidth).toBeCloseTo(1, 2);
        const pdf = await PDFDocument.load(result);
        const link = pdf
          .getPage(1)
          .node.Annots()!
          .lookup(0) as import("@legir/pdfium/authoring").PDFDict;
        const dest = link.lookup(
          PDFName.of("Dest"),
        ) as import("@legir/pdfium/authoring").PDFArray;
        expect((dest.lookup(2) as PDFNumber).asNumber()).toBe(50);
        expect((dest.lookup(3) as PDFNumber).asNumber()).toBe(250);
        const second = await save(store);
        const repeated = await loadPDF(second, { workerService: worker });
        expect(repeated.pages[0].width).toBeCloseTo(500, 3);
        repeated.dispose();
      } finally {
        reopened.dispose();
      }
    } finally {
      store.dispose();
      loaded.dispose();
    }
  });
  it("checks content modification permission independently of page assembly", async () => {
    const { store, loaded } = await fixture();
    try {
      const ids = store.getState().pages.map(getPageId);
      store.setState({
        documentPermissions: {
          ...UNRESTRICTED_PDF_PERMISSIONS,
          canAssemble: true,
          canModifyContents: false,
        },
      });
      expect(() =>
        store
          .getState()
          .cropPages(ids, { top: 1, right: 1, bottom: 1, left: 1 }),
      ).toThrow();
      store.setState({
        documentPermissions: {
          ...UNRESTRICTED_PDF_PERMISSIONS,
          canAssemble: false,
          canModifyContents: true,
        },
      });
      expect(() =>
        store
          .getState()
          .cropPages(ids, { top: 1, right: 1, bottom: 1, left: 1 }),
      ).not.toThrow();
    } finally {
      store.dispose();
      loaded.dispose();
    }
  });
  it("anchors larger paper in the displayed orientation without changing content scale", () => {
    const page = {
      pageIndex: 0,
      width: 400,
      height: 600,
      viewBox: [0, 0, 400, 600] as [number, number, number, number],
      userUnit: 1,
      rotation: 0,
      rotationDelta: 90,
    };
    const geometry = resizePageGeometry(page, {
      width: 800,
      height: 500,
      content: "original",
      anchorX: 1,
      anchorY: 0,
    });
    const edited = { ...page, geometry };
    expect(geometry.scale).toBe(1);
    expect(pagePointToView({ x: 0, y: 600 }, edited, 0)).toEqual({
      x: 200,
      y: 0,
    });
    expect(getPageView(edited, 0)).toMatchObject({ width: 800, height: 500 });
    const cropped = {
      ...edited,
      geometry: cropPageGeometry(edited, {
        left: 20,
        right: 0,
        top: 10,
        bottom: 0,
      }),
    };
    expect(getEditedPage(cropped).width).toBe(490);
  });
});
