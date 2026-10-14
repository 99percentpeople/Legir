import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const worker = {
    loadDocument: vi.fn(),
    renderPageImage: vi.fn(),
    destroy: vi.fn(),
  };
  return { worker, owner: vi.fn(), create: vi.fn(() => worker) };
});
vi.mock("@/services/pdfService/pdfWorkerService", () => ({
  pdfWorkerService: mocks.worker,
  getPdfWorkerForBytes: mocks.owner,
  createPdfWorkerService: mocks.create,
}));
import { renderPdfPreviewDataUrl } from "@/services/recentFilePreview";
import { renderPageBytes } from "@/services/pdfService/pdfRenderer";
import { exportPreviews } from "@/services/pdfService/engine/exportPreviews";

it("uses the saved revision's preview without opening exported bytes or reading the live draft", async () => {
  const blob = new Blob(["saved output"]);
  exportPreviews.set(blob, {
    bytes: new Uint8Array([4, 5, 6]),
    mimeType: "image/jpeg",
  });
  expect(await renderPdfPreviewDataUrl({ pdfBytes: blob })).toMatch(
    /^data:image\/jpeg/,
  );
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.worker.renderPageImage).not.toHaveBeenCalled();
  exportPreviews.set(blob, null);
  expect(await renderPdfPreviewDataUrl({ pdfBytes: blob })).toBeNull();
  expect(mocks.create).not.toHaveBeenCalled();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.owner.mockReturnValue(undefined);
  mocks.worker.loadDocument.mockResolvedValue(true);
  mocks.worker.renderPageImage.mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "image/png",
  });
});

it("reuses the live document for recent previews without opening or closing another PDF", async () => {
  mocks.owner.mockReturnValue(mocks.worker);
  expect(
    await renderPdfPreviewDataUrl({ pdfBytes: new Uint8Array([1]) }),
  ).toMatch(/^data:image\/png/);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.worker.loadDocument).not.toHaveBeenCalled();
  expect(mocks.worker.destroy).not.toHaveBeenCalled();
  expect(mocks.worker.renderPageImage).toHaveBeenCalledWith(
    expect.objectContaining({ docId: "default", pageIndex: 0 }),
  );
});

it("reuses the live source for byte-range rendering", async () => {
  mocks.owner.mockReturnValue(mocks.worker);
  expect(await renderPageBytes(new Uint8Array([1]), 1, [0, 1])).toHaveLength(2);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.worker.loadDocument).not.toHaveBeenCalled();
  expect(mocks.worker.destroy).not.toHaveBeenCalled();
});

it("terminates an unowned preview worker on failure so its WASM arena is released", async () => {
  mocks.worker.renderPageImage.mockRejectedValue(new Error("Decode failed"));
  await expect(
    renderPdfPreviewDataUrl({ pdfBytes: new Uint8Array([1]) }),
  ).rejects.toThrow("Decode failed");
  expect(mocks.worker.loadDocument).toHaveBeenCalledOnce();
  expect(mocks.worker.destroy).toHaveBeenCalledOnce();
});
