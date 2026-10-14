import { describe, expect, it } from "vitest";
import {
  PDFDocument,
  PDFDict,
  PDFArray,
  PDFString,
  PDFName,
  PDFObject,
  degrees,
} from "@legir/pdfium/authoring";
import { exportPDF, loadPDF } from "@/services/pdfService";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { createEditorView } from "@/store/editorView";
import { getPageId } from "@/services/pdfService/lib/pageStructure";
import {
  getPageView,
  pagePointToView,
  viewPointToPage,
} from "@/components/workspace/lib/pageViewRotation";
import { UNRESTRICTED_PDF_PERMISSIONS } from "@/lib/pdfPermissions";
import { isSavedDocumentRevision } from "@/app/editorTabs/saveState";

const worker = {
  loadDocument: async () => true,
  resolveDest: async () => null,
  getOutline: async () => [],
  getPermissions: async () => null,
  renderPageImage: async () => undefined,
} as unknown as PDFWorkerService;
const fixture = async (angle = 0) => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  page.setRotation(degrees(angle));
  const second = doc.addPage([600, 400]);
  const form = doc.getForm();
  const text = form.createTextField("name");
  text.setText("Original");
  text.setMaxLength(20);
  text.enableReadOnly();
  text.addToPage(page, { x: 40, y: 100, width: 150, height: 25 });
  const radio = form.createRadioGroup("choice");
  radio.addOptionToPage("A", page, { x: 40, y: 160 });
  radio.addOptionToPage("B", second, { x: 70, y: 160 });
  radio.select("A");
  const check = form.createCheckBox("check");
  check.addToPage(page, { x: 230, y: 100, width: 20, height: 20 });
  check.check();
  const dropdown = form.createDropdown("plan");
  dropdown.addOptions(["Basic", "Pro"]);
  dropdown.select("Pro");
  dropdown.addToPage(page, { x: 230, y: 160, width: 120, height: 20 });
  const bytes = await doc.save();
  const loaded = await loadPDF(bytes, { workerService: worker });
  const store = createEditorView({
    state: {
      ...loaded,
      pdfBytes: bytes,
      annotations: [
        {
          id: "shape",
          type: "shape",
          shapeType: "square",
          pageIndex: 0,
          rect: { x: 50, y: 250, width: 40, height: 60 },
          color: "#ff0000",
        },
      ],
    },
  });
  return { store, loaded, bytes };
};
const save = async (store: ReturnType<typeof createEditorView>) => {
  const state = store.getState();
  return exportPDF(
    state.pdfBytes!,
    state.fields,
    state.metadata,
    state.annotations,
    undefined,
    {
      pageStructure: { pages: state.pages, sources: state.pageSources },
      syncFormFields: true,
      preservedSourceAnnotations: state.preservedSourceAnnotations,
    },
  );
};

describe("page structure editing", () => {
  it.each([0, 90, 180, 270])(
    "duplicates editable controls and preserves source rotation %s",
    async (angle) => {
      const { store, loaded } = await fixture(angle);
      store.getState().duplicatePages(store.getState().pages.map(getPageId));
      expect(store.getState().pages).toHaveLength(4);
      const copy = store
        .getState()
        .fields.find((field) => field.name === "name_2")!;
      store.setState({
        fields: store
          .getState()
          .fields.map((field) =>
            field.id === copy.id ? { ...field, value: "Copy" } : field,
          ),
      });
      const result = await PDFDocument.load(await save(store));
      expect(result.getPageCount()).toBe(4);
      expect(result.getForm().getTextField("name").getText()).toBe("Original");
      expect(result.getForm().getTextField("name_2").getText()).toBe("Copy");
      expect(result.getForm().getTextField("name_2").isReadOnly()).toBe(true);
      expect(result.getForm().getTextField("name_2").getMaxLength()).toBe(20);
      expect(result.getForm().getRadioGroup("choice_2").getOptions()).toEqual([
        "A",
        "B",
      ]);
      expect(result.getForm().getCheckBox("check_2").isChecked()).toBe(true);
      result.getForm().getCheckBox("check_2").uncheck();
      expect(result.getForm().getCheckBox("check").isChecked()).toBe(true);
      expect(result.getForm().getDropdown("plan_2").getSelected()).toEqual([
        "Pro",
      ]);
      expect(result.getPages().map((p) => p.getRotation().angle)).toEqual([
        angle,
        0,
        angle,
        0,
      ]);
      const reopened = await loadPDF(await save(store), {
        workerService: worker,
      });
      expect(
        reopened.annotations.filter((a) => a.type === "shape"),
      ).toHaveLength(2);
      const originalRect = reopened.fields.find((f) => f.name === "name")!.rect;
      expect(reopened.fields.find((f) => f.name === "name_2")!.rect).toEqual(
        originalRect,
      );
      reopened.dispose();
      loaded.dispose();
      store.dispose();
    },
  );

  it("keeps multiple copies of the same source page independent", async () => {
    const { store, loaded } = await fixture();
    store.getState().duplicatePages([getPageId(store.getState().pages[0])]);
    store
      .getState()
      .duplicatePages(store.getState().pages.slice(0, 2).map(getPageId));
    const result = await PDFDocument.load(await save(store));
    expect(new Set(result.getPages().map((p) => p.ref.toString())).size).toBe(
      5,
    );
    expect(
      result
        .getForm()
        .getFields()
        .map((f) => f.getName())
        .filter((n) => n.startsWith("name")),
    ).toHaveLength(4);
    loaded.dispose();
    store.dispose();
  });

  it("moves, rotates, inserts and deletes with atomic undo and save revisions", async () => {
    const { store, loaded } = await fixture(90);
    const original = store.getState();
    const first = getPageId(original.pages[0]);
    store.getState().movePages([first], 2);
    expect(
      store.getState().fields.find((f) => f.name === "name")?.pageIndex,
    ).toBe(1);
    store.getState().rotatePages([first], 90);
    store
      .getState()
      .addBlankPages({ width: 300, height: 500, count: 2, at: 1 });
    const snapshot = store.getState();
    const output = await PDFDocument.load(await save(store));
    expect(output.getPages().map((p) => p.getRotation().angle)).toEqual([
      0, 0, 0, 180,
    ]);
    expect(output.getPages()[1].getSize()).toEqual({ width: 300, height: 500 });
    store.getState().deletePages([first]);
    expect(store.getState().fields.some((f) => f.name === "name")).toBe(false);
    expect(isSavedDocumentRevision(store.getState(), snapshot)).toBe(false);
    store.getState().undo();
    expect(store.getState().pages).toBe(snapshot.pages);
    store.getState().redo();
    expect(store.getState().pages).toHaveLength(3);
    for (let i = 0; i < 4; i++) store.getState().undo();
    expect(store.getState().pages).toBe(original.pages);
    expect(store.getState().fields).toBe(original.fields);
    loaded.dispose();
    store.dispose();
  });

  it("imports a subset with colliding object refs and field names", async () => {
    const target = await fixture();
    const donor = await fixture(270);
    target.store.getState().insertPdfPages(
      {
        source: { bytes: donor.bytes, filename: "donor.pdf", password: null },
        ...donor.loaded,
        indexes: [1],
      },
      1,
    );
    const result = await PDFDocument.load(await save(target.store));
    expect(result.getPageCount()).toBe(3);
    expect(result.getForm().getRadioGroup("choice_2").getOptions()).toEqual([
      "B",
    ]);
    expect(
      result.getForm().getRadioGroup("choice_2").getSelected(),
    ).toBeUndefined();
    expect(result.getForm().getTextField("name").getText()).toBe("Original");
    for (const page of result.getPages()) {
      const annots = page.node.Annots();
      if (annots)
        for (let i = 0; i < annots.size(); i++)
          expect(
            (result.context.lookup(annots.get(i)) as PDFDict).get(
              PDFName.of("P"),
            ),
          ).toBe(page.ref);
    }
    target.loaded.dispose();
    donor.loaded.dispose();
    target.store.dispose();
    donor.store.dispose();
  });

  it("guards the final page and respects assembly permissions", async () => {
    const { store, loaded } = await fixture();
    const before = store.getState().pages;
    store.getState().deletePages(before.map(getPageId));
    expect(store.getState().pages).toBe(before);
    store.setState({
      documentPermissions: {
        ...UNRESTRICTED_PDF_PERMISSIONS,
        canAssemble: false,
      },
    });
    expect(() =>
      store.getState().rotatePages([getPageId(before[0])], 90),
    ).toThrow(/permissions/);
    expect(store.getState().pages).toBe(before);
    loaded.dispose();
    store.dispose();
  });

  it("removes a deleted radio option and clears its selected value", async () => {
    const { store, loaded } = await fixture();
    store.getState().deletePages([getPageId(store.getState().pages[0])]);
    const result = await PDFDocument.load(await save(store));
    const radio = result.getForm().getRadioGroup("choice");
    expect(radio.getOptions()).toEqual(["B"]);
    expect(radio.getSelected()).toBeUndefined();
    radio.select("B");
    expect(radio.getSelected()).toBe("B");
    loaded.dispose();
    store.dispose();
  });

  it("can leave page mode when only assembly is allowed", async () => {
    const { store, loaded } = await fixture();
    store.setState({
      documentPermissions: {
        ...UNRESTRICTED_PDF_PERMISSIONS,
        canModifyAnnotations: false,
        canModifyContents: false,
        canFillForms: false,
      },
    });
    store.getState().setEditorMode("pages", "select");
    expect(store.getState().mode).toBe("pages");
    store.getState().setEditorMode("annotation", "select");
    expect(store.getState().mode).toBe("annotation");
    loaded.dispose();
    store.dispose();
  });

  it("remaps direct and named links for copies and cleans deleted outline targets", async () => {
    const doc = await PDFDocument.create();
    const pages = [doc.addPage(), doc.addPage(), doc.addPage()];
    doc.catalog.set(
      PDFName.of("Names"),
      doc.context.obj({
        Dests: {
          Names: [PDFString.of("chapter"), [pages[1].ref, PDFName.of("Fit")]],
        },
      }),
    );
    const addLink = (dest: PDFObject | PDFObject[]) =>
      pages[0].node.addAnnot(
        doc.context.register(
          doc.context.obj({
            Type: "Annot",
            Subtype: "Link",
            Rect: [10, 10, 30, 30],
            Dest: dest,
          }),
        ),
      );
    addLink(PDFString.of("chapter"));
    addLink([pages[2].ref, PDFName.of("Fit")]);
    doc.catalog.set(
      PDFName.of("Outlines"),
      doc.context.obj({
        First: {
          Title: PDFString.of("Chapter"),
          Dest: PDFString.of("chapter"),
        },
      }),
    );
    const bytes = await doc.save();
    const loaded = await loadPDF(bytes, {
      workerService: {
        ...worker,
        resolveDest: async () => 1,
      } as unknown as PDFWorkerService,
    });
    const store = createEditorView({ state: { ...loaded, pdfBytes: bytes } });
    store
      .getState()
      .duplicatePages(store.getState().pages.slice(0, 2).map(getPageId));
    const result = await PDFDocument.load(await save(store));
    const links = result.getPage(2).node.Annots()!;
    expect(
      result.context
        .lookup(links.get(0), PDFDict)
        .lookup(PDFName.of("Dest"), PDFArray)
        .get(0),
    ).toBe(result.getPage(3).ref);
    expect(
      result.context
        .lookup(links.get(1), PDFDict)
        .lookup(PDFName.of("Dest"), PDFArray)
        .get(0),
    ).toBe(result.getPage(4).ref);
    store.getState().deletePages([getPageId(store.getState().pages[1])]);
    const deleted = await PDFDocument.load(await save(store));
    const outline = deleted.catalog
      .lookup(PDFName.of("Outlines"), PDFDict)
      .lookup(PDFName.of("First"), PDFDict);
    expect(outline.has(PDFName.of("Dest"))).toBe(false);

    const target = await fixture();
    target.store.getState().insertPdfPages(
      {
        ...loaded,
        source: { bytes, filename: "links.pdf", password: null },
        indexes: [0, 1],
      },
      0,
    );
    const imported = await PDFDocument.load(await save(target.store));
    const importedLinks = imported.getPage(0).node.Annots()!;
    expect(
      imported.context
        .lookup(importedLinks.get(0), PDFDict)
        .lookup(PDFName.of("Dest"), PDFArray)
        .get(0),
    ).toBe(imported.getPage(1).ref);
    expect(
      imported.context
        .lookup(importedLinks.get(1), PDFDict)
        .has(PDFName.of("Dest")),
    ).toBe(false);
    target.loaded.dispose();
    target.store.dispose();
    loaded.dispose();
    store.dispose();
  });

  it("combines saved and reading rotations without changing source coordinates", () => {
    const page = {
      pageIndex: 0,
      width: 400,
      height: 600,
      rotation: 90,
      rotationDelta: 90,
      viewBox: [0, 0, 600, 400] as [number, number, number, number],
      userUnit: 1,
    };
    expect(getPageView(page, 90)).toMatchObject({
      width: 400,
      height: 600,
      rotation: 270,
    });
    expect(
      viewPointToPage(pagePointToView({ x: 30, y: 70 }, page, 270), page, 270),
    ).toEqual({ x: 30, y: 70 });
  });

  it("preserves CropBox and UserUnit while rotating editable form geometry", async () => {
    const doc = await PDFDocument.create();
    const sourcePage = doc.addPage([600, 800]);
    sourcePage.setCropBox(30, 40, 500, 700);
    sourcePage.node.set(PDFName.of("UserUnit"), doc.context.obj(2));
    sourcePage.setRotation(degrees(270));
    doc
      .getForm()
      .createTextField("cropped")
      .addToPage(sourcePage, { x: 80, y: 150, width: 140, height: 30 });
    const loaded = await loadPDF(await doc.save(), { workerService: worker });
    const store = createEditorView({ state: loaded });
    store.getState().rotatePages([getPageId(loaded.pages[0])], 90);
    const state = store.getState();
    const rect = state.fields[0].rect;
    const points = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
    ].map((point) => pagePointToView(point, state.pages[0], 0));
    const saved = await save(store);
    const pdf = await PDFDocument.load(saved);
    expect(pdf.getPage(0).getCropBox()).toEqual(sourcePage.getCropBox());
    expect(pdf.getPage(0).node.get(PDFName.of("UserUnit"))?.toString()).toBe(
      "2",
    );
    expect(pdf.getPage(0).getRotation().angle).toBe(0);
    const reopened = await loadPDF(saved, { workerService: worker });
    expect(reopened.fields[0].rect).toEqual({
      x: Math.min(points[0].x, points[1].x),
      y: Math.min(points[0].y, points[1].y),
      width: Math.abs(points[0].x - points[1].x),
      height: Math.abs(points[0].y - points[1].y),
    });
    reopened.dispose();
    loaded.dispose();
    store.dispose();
  });
});
