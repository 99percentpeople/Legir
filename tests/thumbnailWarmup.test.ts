import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { createTestEditorStore, page } from "./helpers/editorStore";

vi.mock("@/services/pdfService/pdfWorkerService", () => ({
  pdfWorkerService: {},
}));

const image = { bytes: new Uint8Array([1]), mimeType: "image/jpeg" };
const worker = () => ({
  renderPageImage: vi.fn<
    (options: {
      pageIndex: number;
      signal?: AbortSignal;
    }) => Promise<typeof image>
  >(async () => image),
});
const views: ReturnType<typeof createTestEditorStore>[] = [];
const view = () => {
  const store = createTestEditorStore({ pages: [page(0), page(1)] });
  views.push(store);
  return store;
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:thumbnail");
});
afterEach(() => {
  views.splice(0).forEach((store) => store.dispose());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("cancels in-flight warmup during gestures and retries the same page after idle", async () => {
  const store = view();
  const w = worker();
  let finish!: (result: typeof image) => void;
  w.renderPageImage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  store.getState().warmupThumbnails(w as unknown as PDFWorkerService);
  const firstSignal = w.renderPageImage.mock.calls[0][0].signal;
  store.getState().deferThumbnailWarmup();
  expect(firstSignal?.aborted).toBe(true);
  finish(image);
  await vi.advanceTimersByTimeAsync(400);
  expect(store.getState().thumbnailImages).toEqual({});
  store.getState().deferThumbnailWarmup();
  await vi.advanceTimersByTimeAsync(599);
  expect(w.renderPageImage).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(20);
  expect(
    w.renderPageImage.mock.calls.map(([options]) => options.pageIndex),
  ).toEqual([0, 0, 1]);
  expect(Object.keys(store.getState().thumbnailImages)).toEqual(["0", "1"]);
});

it("waits for idle when hydration starts warmup in the middle of a gesture", async () => {
  const store = view();
  const w = worker();
  store.getState().deferThumbnailWarmup();
  store.getState().warmupThumbnails(w as unknown as PDFWorkerService);
  await vi.advanceTimersByTimeAsync(599);
  expect(w.renderPageImage).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(20);
  expect(w.renderPageImage).toHaveBeenCalledTimes(2);
});

it("does not resume warmup after its document is closed", async () => {
  const store = view();
  const w = worker();
  store.getState().deferThumbnailWarmup();
  store.getState().warmupThumbnails(w as unknown as PDFWorkerService);
  store.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(w.renderPageImage).not.toHaveBeenCalled();
});

it("pauses only the interacting document and retains completed thumbnails", async () => {
  const first = view();
  const second = view();
  const a = worker();
  const b = worker();
  first.setState({ thumbnailImages: { 0: "blob:existing" } });
  first.getState().deferThumbnailWarmup();
  first.getState().warmupThumbnails(a as unknown as PDFWorkerService);
  second.getState().warmupThumbnails(b as unknown as PDFWorkerService);
  await vi.advanceTimersByTimeAsync(10);
  expect(a.renderPageImage).not.toHaveBeenCalled();
  expect(b.renderPageImage).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(610);
  expect(
    a.renderPageImage.mock.calls.map(([options]) => options.pageIndex),
  ).toEqual([1]);
  expect(first.getState().thumbnailImages[0]).toBe("blob:existing");
});
