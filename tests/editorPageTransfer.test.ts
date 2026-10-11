import { expect, it, vi } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { loadPDF, exportPDF } from "@/services/pdfService";
import { createEditorView } from "@/store/editorView";
import { createPdfWorkerService } from "@/services/pdfService/pdfWorkerService";
import { createEditorTabSnapshotFromState } from "@/app/editorTabs/storeSnapshot";
import { restoreEditorTabSessionTransfer } from "@/app/editorTabs/transfer";
import { getPageId } from "@/services/pdfService/lib/pageStructure";

vi.mock("@/services/pdfService/pdfWorkerService", () => ({
  createPdfWorkerService: () => {
    const resources: Array<() => void> = [];
    return {
      loadDocument: async () => true,
      resolveDest: async () => null,
      getOutline: async () => [],
      getPermissions: async () => null,
      renderPageImage: async () => undefined,
      configurePages: vi.fn(),
      retainSourceResources: (_id: string, dispose: () => void) =>
        resources.push(dispose),
      destroy: () => resources.forEach((dispose) => dispose()),
    };
  },
}));

it("restores edited structure, imported sources and undo history in another window", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 600]);
  const donor = await PDFDocument.create();
  const donorPage = donor.addPage([200, 300]);
  const text = donor.getForm().createTextField("imported-name");
  text.addToPage(donorPage, { x: 20, y: 50, width: 100, height: 20 });
  text.setText("Imported");
  const worker = createPdfWorkerService();
  const loaded = await loadPDF(await pdf.save(), { workerService: worker });
  const imported = await loadPDF(await donor.save(), { workerService: worker });
  const original = createEditorView({ state: loaded });
  original
    .getState()
    .rotatePages([getPageId(original.getState().pages[0])], 90);
  original.getState().insertPdfPages(
    {
      ...imported,
      indexes: [0],
      source: {
        bytes: imported.pdfBytes,
        password: null,
        filename: "donor.pdf",
      },
    },
    0,
  );
  original.getState().setPageThumbnailScale(1.5);
  const snapshot = createEditorTabSnapshotFromState({
    state: original.getState(),
    scrollContainer: null,
  });
  const restored = await restoreEditorTabSessionTransfer({
    transferId: "transfer",
    createdAt: Date.now(),
    sessionId: "session",
    sourceWindowId: "source",
    title: "edited",
    sourceKey: null,
    lastActiveAt: new Date().toISOString(),
    isDirty: true,
    editorSnapshot: structuredClone(snapshot),
  });
  const target = createEditorView({ state: restored.snapshot });
  expect(target.getState().pageThumbnailScale).toBe(1.5);
  expect(target.getState().pages).toEqual(original.getState().pages);
  expect(target.getState().fields).toEqual(original.getState().fields);
  expect(target.getState().pageSources).toEqual(
    original.getState().pageSources,
  );
  target.getState().undo();
  expect(target.getState().pageThumbnailScale).toBe(1.5);
  expect(target.getState().pages).toHaveLength(1);
  expect(target.getState().pages[0].rotationDelta).toBe(90);
  target.getState().redo();
  const state = target.getState();
  const output = await PDFDocument.load(
    await exportPDF(
      state.pdfBytes!,
      state.fields,
      state.metadata,
      state.annotations,
      undefined,
      {
        pageStructure: { pages: state.pages, sources: state.pageSources },
        syncFormFields: true,
      },
    ),
  );
  expect(output.getPageCount()).toBe(2);
  expect(output.getPage(1).getRotation().angle).toBe(90);
  expect(output.getForm().getTextField("imported-name").getText()).toBe(
    "Imported",
  );
  target.dispose();
  original.dispose();
  loaded.dispose();
  imported.dispose();
  restored.disposePdfResources?.();
  restored.workerService.destroy();
});
