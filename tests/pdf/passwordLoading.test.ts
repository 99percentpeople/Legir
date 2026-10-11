import { afterEach, expect, it, vi } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { appEventBus } from "@/lib/eventBus";
import { exportPDF, loadPDF, startPdfOpenSession } from "@/services/pdfService";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { createEditorView } from "@/store/editorView";

const worker = () => {
  const service = {
    loadDocument: vi.fn(async (_bytes, options) => !!options.password),
    resolveDest: async () => null,
    getOutline: async () => [],
    getPermissions: async () => null,
    renderPageImage: vi.fn(async () => undefined),
  };
  return { service, workerService: service as unknown as PDFWorkerService };
};
const encryptedPdf = async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 300]);
  const field = pdf.getForm().createTextField("encrypted-field");
  field.setText("Imported");
  field.addToPage(page, { x: 20, y: 20, width: 120, height: 24 });
  pdf.encrypt({
    userPassword: "open-test",
    ownerPassword: "owner-test",
    permissions: { copying: true },
  });
  return pdf.save();
};
afterEach(() => appEventBus.clear());

it("reuses password retries for an encrypted import and preserves it through save", async () => {
  const bytes = await encryptedPdf();
  const reasons: string[] = [];
  appEventBus.on("pdf:passwordRequired", (prompt) => {
    reasons.push(prompt.reason);
    prompt.submit(reasons.length === 1 ? "wrong" : "open-test");
  });
  const { service, workerService } = worker();
  const session = startPdfOpenSession(bytes, { workerService });
  const readable = await session.readable;
  expect(readable.pages).toHaveLength(1);
  expect(service.renderPageImage).not.toHaveBeenCalled();
  const donor = await session.hydrate();
  expect(reasons).toEqual(["need_password", "incorrect_password"]);
  expect(donor.openPassword).toBe("open-test");
  expect(service.loadDocument).toHaveBeenLastCalledWith(
    bytes,
    expect.objectContaining({ password: "open-test" }),
  );

  const targetPdf = await PDFDocument.create();
  targetPdf.addPage([300, 400]);
  const target = await loadPDF(await targetPdf.save(), { workerService });
  const store = createEditorView({ state: target });
  try {
    store.getState().insertPdfPages(
      {
        ...donor,
        indexes: [0],
        source: {
          bytes: donor.pdfBytes,
          filename: "encrypted.pdf",
          password: donor.openPassword ?? null,
        },
      },
      1,
    );
    const state = store.getState();
    const saved = await exportPDF(
      state.pdfBytes!,
      state.fields,
      state.metadata,
      state.annotations,
      undefined,
      {
        pageStructure: { pages: state.pages, sources: state.pageSources },
        syncFormFields: true,
      },
    );
    const reopened = await PDFDocument.load(saved);
    expect(reopened.getPageCount()).toBe(2);
    expect(reopened.isEncrypted).toBe(false);
    expect(reopened.getForm().getTextField("encrypted-field").getText()).toBe(
      "Imported",
    );
  } finally {
    donor.dispose();
    target.dispose();
    store.dispose();
  }
});

it.each(["cancel", "dispose"] as const)(
  "ends the pending password request on %s",
  async (action) => {
    const bytes = await encryptedPdf();
    const ended = vi.fn();
    appEventBus.on("pdf:loadEnd", ended);
    const session = startPdfOpenSession(bytes, {
      workerService: worker().workerService,
    });
    appEventBus.on("pdf:passwordRequired", (prompt) => {
      if (action === "cancel") prompt.cancel();
      else session.dispose();
      // A stale dialog callback must not resume an aborted session.
      prompt.submit("open-test");
    });
    await expect(session.readable).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(ended).toHaveBeenCalledOnce();
    expect(ended).toHaveBeenCalledWith({ id: expect.any(String), ok: false });
    session.dispose();
  },
);

it("does not reopen a password prompt after an aborted file read finishes", async () => {
  const bytes = await encryptedPdf();
  const file = new File([], "encrypted.pdf");
  let finishRead!: (buffer: ArrayBuffer) => void;
  file.arrayBuffer = () =>
    new Promise<ArrayBuffer>((resolve) => {
      finishRead = resolve;
    });
  const prompt = vi.fn();
  appEventBus.on("pdf:passwordRequired", prompt);
  const { service, workerService } = worker();
  const session = startPdfOpenSession(file, { workerService });
  session.dispose();
  finishRead(new Uint8Array(bytes).buffer);
  await expect(session.readable).rejects.toMatchObject({ name: "AbortError" });
  expect(prompt).not.toHaveBeenCalled();
  expect(service.loadDocument).not.toHaveBeenCalled();
});
