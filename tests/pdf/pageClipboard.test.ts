import { describe, expect, it } from "vitest";
import { PDFDocument, PDFDict, PDFName } from "@legir/pdfium/authoring";
import { loadPDF, exportPDF } from "@/services/pdfService";
import { exportSelectedPages } from "@/services/pdfService/pageClipboard";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { getPageId } from "@/services/pdfService/lib/pageStructure";
import {
  PdfPermissionDeniedError,
  UNRESTRICTED_PDF_PERMISSIONS,
} from "@/lib/pdfPermissions";
import { createTestEditorStore } from "../helpers/editorStore";

const worker = {
  loadDocument: async () => true,
  resolveDest: async () => null,
  getOutline: async () => [],
  getPermissions: async () => null,
  renderPageImage: async () => undefined,
} as unknown as PDFWorkerService;
async function open(bytes: Uint8Array) {
  const loaded = await loadPDF(bytes, { workerService: worker });
  const store = createTestEditorStore({
    ...loaded,
    pdfBytes: bytes,
    mode: "pages",
    filename: "source.pdf",
  });
  return {
    store,
    loaded,
    dispose: () => {
      store.dispose();
      loaded.dispose();
    },
  };
}
async function fixture() {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 3; i++) {
    const p = pdf.addPage([400 + i * 20, 600]);
    p.drawText(`PAGE ${i + 1}`, { x: 20, y: 550 });
    const field = pdf.getForm().createTextField(`name${i}`);
    field.addToPage(p, { x: 20, y: 400, width: 120, height: 25 });
    field.setText(`original ${i}`);
  }
  const radio = pdf.getForm().createRadioGroup("radio");
  radio.addOptionToPage("A", pdf.getPage(0), { x: 200, y: 400 });
  radio.addOptionToPage("B", pdf.getPage(1), { x: 200, y: 400 });
  radio.select("A");
  return await open(await pdf.save());
}
async function save(store: ReturnType<typeof createTestEditorStore>) {
  const state = store.getState();
  return exportPDF(
    state.pdfBytes!,
    state.fields,
    state.metadata,
    state.annotations,
    undefined,
    {
      pageStructure: { pages: state.pages, sources: state.pageSources },
      preservedSourceAnnotations: state.preservedSourceAnnotations,
      syncFormFields: true,
    },
  );
}

describe("selected page clipboard export and insertion", () => {
  it("captures edited noncontiguous pages in document order, preserves rotation and prunes other fields", async () => {
    const source = await fixture();
    try {
      const { store } = source;
      const ids = store.getState().pages.map(getPageId);
      store
        .getState()
        .updateField(
          store.getState().fields.find((field) => field.name === "name2")!.id,
          { value: "copied edit" },
        );
      store.getState().rotatePages([ids[2]], 90);
      store.getState().addAnnotation({
        id: "comment",
        type: "comment",
        pageIndex: 2,
        rect: { x: 40, y: 40, width: 24, height: 24 },
        text: "copied comment",
        replies: [
          {
            id: "reply",
            parentAnnotationId: "comment",
            text: "copied reply",
          },
        ],
      });
      store.getState().setSelectedPageIds([ids[2], ids[0]]);
      const before = store.getState();
      const pending = exportSelectedPages(before);
      store
        .getState()
        .updateField(
          store.getState().fields.find((field) => field.name === "name2")!.id,
          { value: "later edit" },
        );
      store.getState().rotatePages([ids[2]], 90);
      store.getState().deletePages([ids[0]]);
      const bytes = new Uint8Array(await (await pending).arrayBuffer());
      const result = await PDFDocument.load(bytes);
      expect(result.getPageCount()).toBe(2);
      expect(result.getPages().map((page) => page.getRotation().angle)).toEqual(
        [0, 90],
      );
      expect(result.getForm().getTextField("name2").getText()).toBe(
        "copied edit",
      );
      expect(
        result
          .getForm()
          .getFields()
          .map((field) => field.getName())
          .sort(),
      ).toEqual(["name0", "name2", "radio"]);
      expect(result.getForm().getRadioGroup("radio").getOptions()).toEqual([
        "A",
      ]);
      const imported = await open(bytes);
      try {
        expect(imported.loaded.annotations[0]).toMatchObject({
          text: "copied comment",
          pageIndex: 1,
          replies: [{ text: "copied reply" }],
        });
        const insertion = imported.loaded.pages.map((page) => page.pageIndex);
        const targetBefore = store.getState();
        store.getState().insertPdfPages(
          {
            ...imported.loaded,
            indexes: insertion,
            source: { bytes, password: null, filename: "copied.pdf" },
          },
          1,
        );
        const inserted = store.getState();
        expect(inserted.pages).toHaveLength(4);
        expect(inserted.selectedPageIds).toEqual(
          inserted.pages.slice(1, 3).map(getPageId),
        );
        expect(inserted.past).toHaveLength(targetBefore.past.length + 1);
        store.getState().undo();
        expect(store.getState().pages).toEqual(targetBefore.pages);
        store.getState().redo();
        const saved = await PDFDocument.load(await save(store));
        expect(saved.getPageCount()).toBe(4);
        expect(saved.getForm().getTextField("name2").getText()).toBe(
          "later edit",
        );
        expect(saved.getForm().getTextField("name2_2").getText()).toBe(
          "copied edit",
        );
        for (const page of saved.getPages()) {
          const annots = page.node.Annots();
          for (const ref of annots?.asArray() ?? [])
            expect(
              saved.context.lookup(ref, PDFDict).get(PDFName.of("P")),
            ).toBe(page.ref);
        }
      } finally {
        imported.dispose();
      }
      expect(before.selectedPageIds).toEqual([ids[2], ids[0]]);
    } finally {
      source.dispose();
    }
  });

  it("copies a mix of imported, duplicated and blank pages into a different document", async () => {
    const source = await fixture();
    const donor = await fixture();
    const target = await fixture();
    try {
      const store = source.store;
      store.getState().insertPdfPages(
        {
          ...donor.loaded,
          indexes: [1],
          source: {
            bytes: donor.loaded.pdfBytes,
            password: null,
            filename: "donor.pdf",
          },
        },
        0,
      );
      const importedId = getPageId(store.getState().pages[0]);
      store.getState().duplicatePages([importedId]);
      store
        .getState()
        .addBlankPages({ width: 200, height: 300, count: 1, at: 1 });
      const ids = store.getState().pages.slice(0, 3).map(getPageId);
      store.getState().setSelectedPageIds(ids);
      const before = store.getState();
      const bytes = new Uint8Array(
        await (await exportSelectedPages(before)).arrayBuffer(),
      );
      expect(store.getState()).toBe(before);
      const copied = await open(bytes);
      try {
        expect(copied.loaded.pages).toHaveLength(3);
        expect(copied.loaded.pages[1]).toMatchObject({
          width: 200,
          height: 300,
        });
        expect(
          copied.loaded.fields.filter((field) => field.type === "Text"),
        ).toHaveLength(2);
        target.store.getState().insertPdfPages(
          {
            ...copied.loaded,
            indexes: [0, 1, 2],
            source: { bytes, password: null, filename: "copy.pdf" },
          },
          0,
        );
        const saved = await PDFDocument.load(await save(target.store));
        expect(saved.getPageCount()).toBe(6);
        expect(
          saved
            .getForm()
            .getFields()
            .filter((field) => field.getName().startsWith("name1")),
        ).toHaveLength(3);
      } finally {
        copied.dispose();
      }
    } finally {
      source.dispose();
      donor.dispose();
      target.dispose();
    }
  });

  it("does not export an empty selection or a document that forbids copying", async () => {
    const source = await fixture();
    try {
      expect(() => exportSelectedPages(source.store.getState())).toThrow(
        "No pages selected",
      );
      source.store
        .getState()
        .setSelectedPageIds([getPageId(source.store.getState().pages[0])]);
      source.store.setState({
        documentPermissions: {
          ...UNRESTRICTED_PDF_PERMISSIONS,
          canCopy: false,
        },
      });
      expect(() => exportSelectedPages(source.store.getState())).toThrow(
        PdfPermissionDeniedError,
      );
    } finally {
      source.dispose();
    }
  });
});
