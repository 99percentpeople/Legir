import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "@legir/pdfium/authoring";
import { PDFPage as NativePage, PDFRenderTask } from "@legir/pdfium";
import * as editing from "@/services/pdfService/engine/editingDocument";
import { getPDFium } from "@/services/pdfService/engine/runtime";
import { loadPDF, startPdfOpenSession } from "@/services/pdfService";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import {
  createRenderedPageImageCropper,
  cropRenderedPageImageToDataUrl,
} from "@/services/pdfService/lib/renderedImageCrop";

const draw = vi.fn();
const encode = vi.fn();
const bitmaps: FakeBitmap[] = [];
const surfaces: FakeCanvas[] = [];
class FakeBitmap {
  width = 400;
  height = 600;
  close = vi.fn();
  constructor() {
    bitmaps.push(this);
  }
}
class FakeCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {
    surfaces.push(this);
  }
  getContext() {
    return { drawImage: draw };
  }
  convertToBlob() {
    return encode(this.width, this.height);
  }
}
const options = () => ({
  bytes: new Uint8Array([1]),
  mimeType: "image/png",
  pageWidth: 200,
  pageHeight: 300,
});
const rect = { x: 20, y: 30, width: 40, height: 50 };

beforeEach(() => {
  bitmaps.length = 0;
  surfaces.length = 0;
  draw.mockReset();
  encode.mockReset();
  encode.mockImplementation(
    async () => new Blob(["png"], { type: "image/png" }),
  );
  vi.stubGlobal("ImageBitmap", FakeBitmap);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => new FakeBitmap()),
  );
  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("decoded page image lifecycle", () => {
  it("decodes once for many crops and releases each temporary surface", async () => {
    const cropper = await createRenderedPageImageCropper(options());
    for (let i = 0; i < 20; i++) {
      expect(await cropper.crop(rect)).toMatchObject({
        width: 80,
        height: 100,
        dataUrl: "data:image/png;base64,cG5n",
      });
    }
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(draw).toHaveBeenCalledTimes(20);
    expect(draw.mock.calls[0].slice(1)).toEqual([
      40, 60, 80, 100, 0, 0, 80, 100,
    ]);
    expect(
      surfaces.every((surface) => surface.width === 0 && surface.height === 0),
    ).toBe(true);
    expect(bitmaps[0].close).not.toHaveBeenCalled();
    cropper.dispose();
    cropper.dispose();
    expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
    await expect(cropper.crop(rect)).rejects.toThrow("disposed");
  });

  it("retains single-crop compatibility and releases resources on encoding failure", async () => {
    encode.mockRejectedValueOnce(new Error("Encoding failed"));
    await expect(
      cropRenderedPageImageToDataUrl({ ...options(), cropRect: rect }),
    ).rejects.toThrow("Encoding failed");
    expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
    expect(surfaces[0].width).toBe(0);
    expect(surfaces[0].height).toBe(0);
  });

  it("allows later crops to succeed after one crop fails", async () => {
    const cropper = await createRenderedPageImageCropper(options());
    encode.mockRejectedValueOnce(new Error("Encoding failed"));
    try {
      await expect(cropper.crop(rect)).rejects.toThrow();
      expect(await cropper.crop(rect)).toBeDefined();
      expect(createImageBitmap).toHaveBeenCalledTimes(1);
    } finally {
      cropper.dispose();
    }
    expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...rect, x: Number.NaN },
    { ...rect, width: 0 },
    { ...rect, x: 300 },
    { ...rect, height: Number.POSITIVE_INFINITY },
  ])(
    "rejects invalid/outside rectangles before decoding (%j)",
    async (cropRect) => {
      expect(
        await cropRenderedPageImageToDataUrl({ ...options(), cropRect }),
      ).toBeUndefined();
      expect(createImageBitmap).not.toHaveBeenCalled();
    },
  );

  it("clamps partially off-page crops without changing pixel rounding", async () => {
    const output = await cropRenderedPageImageToDataUrl({
      ...options(),
      cropRect: { x: -10, y: 280, width: 30, height: 50 },
    });
    expect(output).toMatchObject({ width: 40, height: 40 });
    expect(draw.mock.calls[0].slice(1)).toEqual([0, 560, 40, 40, 0, 0, 40, 40]);
  });

  it("keeps HTMLImage decoding available when ImageBitmap is unsupported", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const create = vi.fn(() => "blob:test");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    class FakeImage {
      naturalWidth = 400;
      naturalHeight = 600;
      onload: (() => void) | null = null;
      set src(_url: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", FakeImage);
    const output = await cropRenderedPageImageToDataUrl({
      ...options(),
      cropRect: rect,
    });
    expect(output).toMatchObject({ width: 80, height: 100 });
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:test");
  });
});

const stampSource = async (count = 10) => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 300]);
  for (let i = 0; i < count; i++) {
    page.node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Stamp",
          Rect: [10, 20 + i * 10, 30, 30 + i * 10],
          P: page.ref,
        }),
      ),
    );
  }
  return doc.save();
};
const mockWorker = () => ({
  loadDocument: vi.fn(async () => true),
  resolveDest: vi.fn(async () => null),
  getOutline: vi.fn(async () => []),
  getPermissions: vi.fn(async () => null),
  renderPageImage: vi.fn(
    async (options: Parameters<PDFWorkerService["renderPageImage"]>[0]) => ({
      bytes: new Uint8Array([1]),
      mimeType: options.mimeType ?? "image/png",
    }),
  ),
  unloadDocument: vi.fn(),
});

describe("stamp render fallback batching", () => {
  it("renders from the existing owner once per page and decodes once for all stamps", async () => {
    const worker = mockWorker();
    const pdfium = await getPDFium();
    const before = pdfium.liveDocuments();
    const render = editing.renderEditingAnnotations;
    const counts: number[] = [];
    const fallback = vi
      .spyOn(editing, "renderEditingAnnotations")
      .mockImplementation(async (...args) => {
        counts.push(pdfium.liveDocuments());
        return render(...args);
      });
    const startRender = vi.spyOn(NativePage.prototype, "startRender");
    const result = await loadPDF(await stampSource(), {
      workerService: worker as unknown as PDFWorkerService,
    });
    try {
      expect(
        result.annotations.filter((annotation) => annotation.type === "stamp"),
      ).toHaveLength(10);
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(startRender).toHaveBeenCalledExactlyOnceWith(
        expect.any(Array),
        [0, 0, 400, 600],
        { contents: false, annotations: true },
      );
      expect(counts).toEqual([before + 1]);
      expect(pdfium.liveDocuments()).toBe(before);
      expect(worker.renderPageImage).not.toHaveBeenCalled();
      expect(worker.unloadDocument).not.toHaveBeenCalled();
      expect(createImageBitmap).toHaveBeenCalledTimes(1);
      expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
    } finally {
      result.dispose();
    }
  });

  it("releases the native page and owner even when rendering rejects", async () => {
    const worker = mockWorker();
    const bytes = await stampSource();
    const pdfium = await getPDFium();
    const before = pdfium.liveDocuments();
    vi.spyOn(NativePage.prototype, "startRender").mockImplementationOnce(() => {
      throw new Error("Render failed");
    });
    const destroyPage = vi.spyOn(NativePage.prototype, "destroy");
    const result = await loadPDF(bytes, {
      workerService: worker as unknown as PDFWorkerService,
    });
    result.dispose();
    expect(destroyPage).toHaveBeenCalledTimes(1);
    expect(pdfium.liveDocuments()).toBe(before);
    expect(worker.renderPageImage).not.toHaveBeenCalled();
    expect(worker.unloadDocument).not.toHaveBeenCalled();
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("keeps concurrent fallback renders attached to their respective owners", async () => {
    const worker = mockWorker();
    const bytes = await stampSource(1);
    const fallback = vi.spyOn(editing, "renderEditingAnnotations");
    const results = await Promise.all(
      [0, 1].map(() =>
        loadPDF(bytes, {
          workerService: worker as unknown as PDFWorkerService,
        }),
      ),
    );
    results.forEach((result) => result.dispose());
    expect(fallback).toHaveBeenCalledTimes(2);
    expect(
      new Set(fallback.mock.calls.map(([document]) => document)).size,
    ).toBe(2);
    expect(worker.renderPageImage).not.toHaveBeenCalled();
    expect(worker.unloadDocument).not.toHaveBeenCalled();
    expect(bitmaps).toHaveLength(2);
    expect(
      bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 1),
    ).toBe(true);
  });

  it("aborts pending hydration without decoding or creating a scratch document", async () => {
    const worker = mockWorker();
    let complete!: (value: {
      bytes: Uint8Array<ArrayBuffer>;
      mimeType: string;
    }) => void;
    const fallback = vi
      .spyOn(editing, "renderEditingAnnotations")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
    const session = startPdfOpenSession(await stampSource(1), {
      workerService: worker as unknown as PDFWorkerService,
    });
    await session.readable;
    const pending = session.hydrate();
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() => expect(fallback).toHaveBeenCalledTimes(1));
    session.abort();
    complete({ bytes: new Uint8Array([1]), mimeType: "image/png" });
    await rejected;
    session.dispose();
    expect(fallback.mock.calls[0][3]?.aborted).toBe(true);
    expect(worker.renderPageImage).not.toHaveBeenCalled();
    expect(worker.unloadDocument).not.toHaveBeenCalled();
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("cancels a progressive annotation render and releases its task and page", async () => {
    const document = await PDFDocument.load(await stampSource(1));
    const controller = new AbortController();
    vi.spyOn(PDFRenderTask.prototype, "continue").mockImplementationOnce(() => {
      controller.abort();
      return false;
    });
    const destroyTask = vi.spyOn(PDFRenderTask.prototype, "destroy");
    const destroyPage = vi.spyOn(NativePage.prototype, "destroy");
    await expect(
      editing.renderEditingAnnotations(document, 0, 2, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(destroyTask).toHaveBeenCalled();
    expect(destroyPage).toHaveBeenCalledTimes(1);
    expect(document.getPageCount()).toBe(1);
    expect(
      (await editing.renderEditingAnnotations(document, 0, 2)).bytes.length,
    ).toBeGreaterThan(8);
  });
});
