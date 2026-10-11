import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestEditorStore, field, page } from "./helpers/editorStore";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import type { EditorView } from "@/store/editorView";
import type { ThumbnailContent } from "@/services/pdfService/types";

const render = vi.hoisted(() => vi.fn());
vi.mock("@/services/pdfService/thumbnailRenderer", async (original) => ({
  ...(await original<object>()),
  renderThumbnail: render,
}));
const worker = {} as PDFWorkerService;
const stores: EditorView[] = [];
const drain = () => vi.advanceTimersByTimeAsync(650);
beforeEach(() => {
  vi.useFakeTimers();
  let revision = 0;
  render.mockImplementation(
    async (_worker, pageIndex) => `blob:${pageIndex}-${++revision}`,
  );
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) =>
    setTimeout(callback, 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("URL", { revokeObjectURL: vi.fn() });
});
afterEach(() => {
  stores.splice(0).forEach((store) => store.dispose());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function setup() {
  const store = createTestEditorStore({
    pages: [page(0), page(1), page(2)],
    fields: [field("name", { value: "before" })],
  });
  stores.push(store);
  store.getState().warmupThumbnails(worker);
  await drain();
  expect(render).toHaveBeenCalledTimes(3);
  render.mockClear();
  return store;
}

it("coalesces edits, keeps old images while pending, and refreshes only the affected page through undo/redo", async () => {
  const store = await setup();
  const before = store.getState().thumbnailImages;
  store.getState().saveCheckpoint();
  for (const value of ["a", "ab", "abc"]) {
    store.getState().updateField("name", { value });
    await vi.advanceTimersByTimeAsync(100);
  }
  expect(render).not.toHaveBeenCalled();
  expect(store.getState().thumbnailImages).toBe(before);
  await drain();
  expect(render).toHaveBeenCalledTimes(1);
  expect(render.mock.calls[0][3].fields[0].value).toBe("abc");
  expect(store.getState().thumbnailImages[0]).not.toBe(before[0]);
  expect(store.getState().thumbnailImages[1]).toBe(before[1]);
  expect(store.getState().thumbnailImages[2]).toBe(before[2]);
  store.getState().undo();
  await drain();
  expect(render.mock.lastCall?.[3].fields[0].value).toBe("before");
  store.getState().redo();
  await drain();
  expect(render.mock.lastCall?.[3].fields[0].value).toBe("abc");
});

it("refreshes annotation add/update/delete and all pages affected by a shared form field", async () => {
  const store = await setup();
  store.setState({
    fields: [
      ...store.getState().fields,
      field("other", { name: "name", pageIndex: 2 }),
    ],
  });
  await drain();
  render.mockClear();
  store.getState().updateField("name", { value: "synced" });
  await drain();
  expect(new Set(render.mock.calls.map((call) => call[1]))).toEqual(
    new Set([0, 2]),
  );
  render.mockClear();
  store.getState().addAnnotation({
    id: "note",
    pageIndex: 1,
    type: "comment",
    rect: { x: 20, y: 20, width: 20, height: 20 },
  });
  await drain();
  expect(render.mock.lastCall?.[1]).toBe(1);
  store.getState().updateAnnotation("note", { color: "#00ff00" });
  await drain();
  expect(render.mock.lastCall?.[3].annotations[0].color).toBe("#00ff00");
  store.getState().deleteAnnotation("note");
  await drain();
  expect(render.mock.lastCall?.[3].annotations).toHaveLength(0);
  expect(render).toHaveBeenCalledTimes(3);
});

it("reuses images through reorder, rotation, selection, zoom and undo", async () => {
  const store = await setup();
  const before = store.getState().thumbnailImages;
  store.getState().movePages(["original:0"], 3);
  store.getState().setSelectedPageIds(["original:0", "original:1"]);
  store.getState().setPageThumbnailScale(1.2);
  await vi.advanceTimersByTimeAsync(5000);
  expect(render).not.toHaveBeenCalled();
  expect(store.getState().thumbnailImages[2]).toBe(before[0]);
  store.getState().undo();
  await drain();
  store.getState().rotatePages(["original:0"], 90);
  await drain();
  expect(render).not.toHaveBeenCalled();
  expect(store.getState().thumbnailImages[0]).toBe(before[0]);
});

it("rejects late results after an edit or disposal, without blanking the old image", async () => {
  const store = await setup();
  const before = store.getState().thumbnailImages;
  let finish!: (url: string) => void;
  render.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  store.getState().updateField("name", { value: "old revision" });
  await drain();
  store.getState().updateField("name", { value: "current" });
  finish("blob:stale");
  await vi.advanceTimersByTimeAsync(100);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:stale");
  expect(store.getState().thumbnailImages).toBe(before);
  await drain();
  expect(render.mock.lastCall?.[3].fields[0].value).toBe("current");
  render.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  store.getState().updateField("name", { value: "closing" });
  await drain();
  const closing = store.getState().thumbnailImages;
  store.dispose();
  finish("blob:disposed");
  await drain();
  expect(store.getState().thumbnailImages).toBe(closing);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:disposed");
});

it("renders copied and blank pages with live controls, keeps other documents isolated, and retries failures on the next edit", async () => {
  const store = await setup();
  const other = createTestEditorStore({ pages: [page()], fields: [] });
  stores.push(other);
  store.getState().duplicatePages(["original:0"]);
  await drain();
  expect(render).toHaveBeenCalledTimes(1);
  expect((render.mock.lastCall?.[3] as ThumbnailContent).fields[0].value).toBe(
    "before",
  );
  expect(other.getState().thumbnailImages).toEqual({});
  store.getState().addBlankPages({ width: 600, height: 800, count: 1, at: 4 });
  store.getState().addAnnotation({
    id: "blank-note",
    pageIndex: 4,
    type: "comment",
    rect: { x: 10, y: 10, width: 20, height: 20 },
  });
  await drain();
  expect(render.mock.lastCall?.[3].annotations[0].id).toBe("blank-note");

  render.mockClear();
  render.mockRejectedValueOnce(new Error("temporary render failure"));
  const old = store.getState().thumbnailImages[0];
  store.getState().updateField("name", { value: "retry" });
  await drain();
  expect(store.getState().thumbnailImages[0]).toBe(old);
  store.getState().updateField("name", { value: "retried" });
  await drain();
  expect(store.getState().thumbnailImages[0]).not.toBe(old);
});

function coldStore(count = 7) {
  const store = createTestEditorStore({
    pages: Array.from({ length: count }, (_, index) => page(index)),
    currentPageIndex: count - 1,
  });
  stores.push(store);
  return store;
}
const renderedPages = () => render.mock.calls.map((call) => call[1]);

it("waits for visibility, renders visible pages first, then warms the rest in page order", async () => {
  const store = coldStore();
  const viewport = Symbol();
  store.getState().setThumbnailViewport(viewport, null);
  store.getState().warmupThumbnails(worker);
  await drain();
  expect(render).not.toHaveBeenCalled();
  store.getState().setThumbnailViewport(viewport, ["original:4", "original:3"]);
  await drain();
  expect(renderedPages()).toEqual([3, 4, 0, 1, 2, 5, 6]);
  expect(render.mock.calls.map((call) => call[4])).toEqual([
    20, 20, 10000, 10000, 10000, 10000, 10000,
  ]);
  // Scrolling a fully rendered document must not re-render pages.
  store.getState().setThumbnailViewport(viewport, ["original:6"]);
  await drain();
  expect(render).toHaveBeenCalledTimes(7);
});

it("updates the next job on scroll without canceling useful work or retaining old priorities", async () => {
  const store = coldStore();
  const viewport = Symbol();
  let finish!: (url: string) => void;
  render.mockImplementationOnce(
    () => new Promise<string>((resolve) => (finish = resolve)),
  );
  store.getState().setThumbnailViewport(viewport, ["original:2", "original:3"]);
  store.getState().warmupThumbnails(worker);
  await drain();
  expect(renderedPages()).toEqual([2]);
  const signal = render.mock.calls[0][2] as AbortSignal;
  store.getState().setThumbnailViewport(viewport, ["original:6", "original:5"]);
  expect(signal.aborted).toBe(false);
  finish("blob:first");
  await drain();
  expect(renderedPages()).toEqual([2, 5, 6, 0, 1, 3, 4]);
});

it("cleans up mode priorities and resumes background work if a measuring viewport unmounts", async () => {
  const store = coldStore();
  const sidebar = Symbol();
  const grid = Symbol();
  store.getState().setThumbnailViewport(sidebar, ["original:4"]);
  store.getState().setThumbnailViewport(grid, null);
  store.getState().warmupThumbnails(worker);
  await drain();
  expect(render).not.toHaveBeenCalled();
  store.getState().removeThumbnailViewport(sidebar);
  store.getState().setThumbnailViewport(grid, ["original:5"]);
  await drain();
  expect(renderedPages()).toEqual([5, 0, 1, 2, 3, 4, 6]);

  render.mockClear();
  const other = coldStore(2);
  other.getState().setThumbnailViewport(sidebar, null);
  other.getState().warmupThumbnails(worker);
  await drain();
  expect(render).not.toHaveBeenCalled();
  other.getState().removeThumbnailViewport(sidebar);
  await drain();
  expect(renderedPages()).toEqual([0, 1]);
});

it("keeps rendering while drag/drop images are held, and releases old URLs after the last preview closes", async () => {
  const store = await setup();
  const old = store.getState().thumbnailImages[0];
  const releaseDrag = store.getState().holdThumbnailImages();
  const releaseDrop = store.getState().holdThumbnailImages();
  store.getState().updateField("name", { value: "during drag" });
  await drain();
  expect(render).toHaveBeenCalledTimes(1);
  expect(store.getState().thumbnailImages[0]).not.toBe(old);
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(old);
  store.getState().movePages(["original:0"], 3);
  await drain();
  expect(render).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(old);
  releaseDrag();
  releaseDrag();
  await drain();
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(old);
  releaseDrop();
  await drain();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(old);
});

it("does not restart a canceled document when its viewport unmounts", async () => {
  const store = coldStore();
  const viewport = Symbol();
  store.getState().setThumbnailViewport(viewport, null);
  store.getState().warmupThumbnails(worker);
  store.dispose();
  store.getState().removeThumbnailViewport(viewport);
  await drain();
  expect(render).not.toHaveBeenCalled();
});

it("resumes unfinished thumbnails immediately after a drop remaps page indexes", async () => {
  const store = coldStore();
  let finish!: (url: string) => void;
  render.mockImplementationOnce(
    () => new Promise<string>((resolve) => (finish = resolve)),
  );
  store.getState().warmupThumbnails(worker);
  await drain();
  expect(render).toHaveBeenCalledTimes(1);
  const signal = render.mock.calls[0][2] as AbortSignal;
  store.getState().movePages(["original:0"], 7);
  expect(signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(20);
  expect(Object.keys(store.getState().thumbnailImages)).toHaveLength(7);
  finish("blob:before-reorder");
  await drain();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:before-reorder");
  expect(Object.values(store.getState().thumbnailImages)).not.toContain(
    "blob:before-reorder",
  );
});
