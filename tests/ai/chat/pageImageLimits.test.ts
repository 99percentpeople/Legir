import { describe, expect, test, vi } from "vitest";
import { createDocumentContextService } from "@/services/ai/chat/documentContextService";
import { AI_CHAT_PAGE_IMAGE_MAX_BYTES } from "@/constants";
import type { AiDocumentSnapshot } from "@/services/ai/chat/types";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { page } from "../../helpers/editorStore";

const setup = (
  options: {
    exported?: boolean;
    fallback?: boolean;
    rotation?: number;
    userUnit?: number;
  } = {},
) => {
  const pages = [0, 1, 2, 3].map((index) => ({
    ...page(index),
    width: 12000,
    height: 8000,
    viewBox: [0, 0, 12000, 8000],
    rotation: options.rotation ?? 0,
    userUnit: options.userUnit ?? 1,
  }));
  const render = vi.fn<PDFWorkerService["renderPageImage"]>(async () => ({
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "image/png",
  }));
  const load = vi.fn(async () => true);
  const unload = vi.fn();
  const exportPages = vi.fn<
    (args: { pageNumbers: number[] }) => Promise<Uint8Array>
  >(async () => new Uint8Array([1]));
  const analyze = vi.fn<
    NonNullable<
      Parameters<typeof createDocumentContextService>[0]["analyzeRenderedPages"]
    >
  >(async () => "bounded visual summary");
  const service = createDocumentContextService({
    getSnapshot: () => ({ pages, currentPageIndex: 0 }) as AiDocumentSnapshot,
    getSelectedTextContext: () => null,
    getRenderablePdfBytes: options.exported ? exportPages : undefined,
    analyzeRenderedPages: options.fallback ? analyze : undefined,
    workerService: {
      renderPageImage: render,
      loadDocument: load,
      unloadDocument: unload,
    } as unknown as PDFWorkerService,
  });
  return { service, render, load, unload, exportPages, analyze };
};

const expectBounded = (image: {
  renderedWidth: number;
  renderedHeight: number;
  imageByteLength?: number;
}) => {
  expect(
    Math.max(image.renderedWidth, image.renderedHeight),
  ).toBeLessThanOrEqual(2048);
  expect(image.renderedWidth * image.renderedHeight).toBeLessThanOrEqual(
    2_000_000,
  );
  expect(image.imageByteLength).toBeLessThanOrEqual(
    AI_CHAT_PAGE_IMAGE_MAX_BYTES,
  );
};

describe("bounded PDF image rendering", () => {
  test.each([false, true])(
    "bounds large drawings before rendering and caps batches, exported=%s",
    async (exported) => {
      const { service, render, exportPages, unload } = setup({ exported });
      const result = await service.getPagesVisual({
        pageNumbers: [3, 1, 2, 4],
      });
      expect(result).toMatchObject({
        requestedPageCount: 4,
        returnedPageCount: 2,
        maxPagesPerCall: 2,
        truncated: true,
      });
      expect(result.pages.map((image) => image.pageNumber)).toEqual([3, 1]);
      for (const image of result.pages) {
        expectBounded(image);
        expect(image.downscaled).toBe(true);
      }
      expect(render).toHaveBeenCalledTimes(2);
      for (const [request] of render.mock.calls)
        expect(request.scale! * 12000).toBeLessThanOrEqual(2048);
      if (exported) {
        expect(exportPages).toHaveBeenCalledWith(
          expect.objectContaining({ pageNumbers: [1, 3] }),
        );
        expect(render.mock.calls.map(([request]) => request.pageIndex)).toEqual(
          [1, 0],
        );
        expect(unload).toHaveBeenCalledOnce();
      }
    },
  );

  test.each([false, true])(
    "renders only crop regions at useful density, exported=%s",
    async (exported) => {
      const { service, render, exportPages } = setup({ exported });
      const crops = [
        { page: 1, rect: { x: 9000, y: 100, width: 300, height: 200 } },
        { page: 1, rect: { x: 1000, y: 500, width: 200, height: 200 } },
      ];
      const result = await service.getPagesVisual({ pageNumbers: crops });
      expect(render.mock.calls.map(([request]) => request.clipRect)).toEqual(
        crops.map((item) => item.rect),
      );
      expect(
        render.mock.calls.every(([request]) => request.scale === 1.5),
      ).toBe(true);
      expect(result.pages[0]).toMatchObject({
        renderedWidth: 450,
        renderedHeight: 300,
        downscaled: false,
        cropRect: crops[0]!.rect,
      });
      if (exported)
        expect(exportPages).toHaveBeenCalledWith(
          expect.objectContaining({ pageNumbers: [1] }),
        );
    },
  );

  test("includes page rotation and user units in both bounds and crop coordinates", async () => {
    const { service, render } = setup({ rotation: 90, userUnit: 2 });
    const result = await service.getPagesVisual({
      pageNumbers: [
        1,
        { page: 1, rect: { x: 15900, y: 23900, width: 200, height: 200 } },
      ],
    });
    expect(result.pages[0]).toMatchObject({
      pageWidth: 16000,
      pageHeight: 24000,
      rotation: 90,
    });
    expectBounded(result.pages[0]!);
    expect(result.pages[1]).toMatchObject({
      cropRect: { x: 15900, y: 23900, width: 100, height: 100 },
      renderedWidth: 150,
      renderedHeight: 150,
    });
    expect(render.mock.calls[1]![0]).toMatchObject({
      rotation: 90,
      scale: 1.5,
    });
  });

  test("falls back to JPEG and smaller rasters when encoded bytes exceed the cap", async () => {
    const { service, render } = setup();
    const oversized = {
      bytes: new Uint8Array(AI_CHAT_PAGE_IMAGE_MAX_BYTES + 1),
      mimeType: "image/png",
    };
    render
      .mockResolvedValueOnce(oversized)
      .mockResolvedValueOnce(oversized)
      .mockResolvedValueOnce({
        bytes: new Uint8Array([4]),
        mimeType: "image/jpeg",
      });
    const result = await service.getPagesVisual({ pageNumbers: [1] });
    expect(render.mock.calls.map(([request]) => request.mimeType)).toEqual([
      "image/png",
      "image/jpeg",
      "image/jpeg",
    ]);
    expect(render.mock.calls[2]![0].scale).toBeLessThan(
      render.mock.calls[0]![0].scale!,
    );
    expect(result.pages[0]).toMatchObject({
      mimeType: "image/jpeg",
      imageByteLength: 1,
    });
    expectBounded(result.pages[0]!);
  });

  test("fails with a crop instruction and frees the snapshot if bytes remain too large", async () => {
    const { service, render, unload } = setup({ exported: true });
    render.mockResolvedValue({
      bytes: new Uint8Array(AI_CHAT_PAGE_IMAGE_MAX_BYTES + 1),
      mimeType: "image/png",
    });
    await expect(service.getPagesVisual({ pageNumbers: [1] })).rejects.toThrow(
      "Request a smaller page-space crop",
    );
    expect(render).toHaveBeenCalledTimes(4);
    expect(unload).toHaveBeenCalledOnce();
  });

  test("cancellation does not start later images and always releases the temporary document", async () => {
    const { service, render, unload } = setup({ exported: true });
    const controller = new AbortController();
    render.mockImplementationOnce(async () => {
      controller.abort();
      return { bytes: new Uint8Array([1]), mimeType: "image/png" };
    });
    await expect(
      service.getPagesVisual({
        pageNumbers: [1, 2],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(render).toHaveBeenCalledOnce();
    expect(unload).toHaveBeenCalledOnce();
  });

  test("the text-only visual fallback gets the same bounded images", async () => {
    const { service, analyze } = setup({ fallback: true });
    const result = await service.inspectPagesVisual!({
      pageNumbers: [1, 2, 3, 4],
    });
    expect(result).toMatchObject({ returnedPageCount: 2, truncated: true });
    expect(analyze).toHaveBeenCalledOnce();
    for (const image of analyze.mock.calls[0]![0].pages) expectBounded(image);
  });
});
