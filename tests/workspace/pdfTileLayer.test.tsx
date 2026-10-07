import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import PDFTileLayer from "@/components/workspace/layers/PDFTileLayer";
import PDFCanvasLayer from "@/components/workspace/layers/PDFCanvasLayer";
import { appEventBus } from "@/lib/eventBus";
import { useEditorView } from "@/store/useEditorView";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";

const page = {
  pageIndex: 0,
  width: 12000,
  height: 8000,
  viewBox: [0, 0, 12000, 8000] as [number, number, number, number],
  rotation: 0,
  userUnit: 1,
};
let host: HTMLDivElement;
let pageEl: HTMLDivElement;
let root: Root;
let pageLeft = 0;
let pageScale = 1;
const rect = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  left: x,
  top: y,
  width,
  height,
  right: x + width,
  bottom: y + height,
  toJSON: () => ({}),
});
const frames = async (n = 5) => {
  for (let i = 0; i < n; i++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
};
const worker = (hold = false) => ({
  renderPage: vi.fn((options: { signal: AbortSignal }) =>
    hold
      ? new Promise<boolean>((resolve) =>
          options.signal.addEventListener("abort", () => resolve(false), {
            once: true,
          }),
        )
      : Promise.resolve(true),
  ),
  reprioritize: vi.fn(async () => true),
  releaseCanvas: vi.fn(async () => true),
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  Object.defineProperty(
    HTMLCanvasElement.prototype,
    "transferControlToOffscreen",
    { configurable: true, value: vi.fn(() => ({})) },
  );
  pageLeft = 0;
  pageScale = 1;
  host = document.createElement("div");
  pageEl = document.createElement("div");
  pageEl.id = "page-0";
  host.append(pageEl);
  document.body.append(host);
  host.getBoundingClientRect = () => rect(0, 0, 1200, 800);
  pageEl.getBoundingClientRect = () =>
    rect(pageLeft, 0, 12000 * pageScale, 8000 * pageScale);
  root = createRoot(pageEl);
  appEventBus.emit(
    "workspace:scrollContainerReady",
    { element: host },
    { sticky: true },
  );
  useEditorView.setState({
    pages: [page],
    thumbnailImages: { 0: "data:image/png;base64,placeholder" },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  appEventBus.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>)
    .transferControlToOffscreen;
});
it("renders only the visible tiles and a small neighboring area", async () => {
  const w = worker();
  await act(async () =>
    root.render(
      <PDFTileLayer
        workerService={w as unknown as PDFWorkerService}
        page={page}
        scale={1}
        isInView
        isRendered={false}
      />,
    ),
  );
  await frames();
  const calls = w.renderPage.mock.calls.map(
    ([call]) => call as unknown as { tile: number[]; canvasId: string },
  );
  const unique = Array.from(
    new Map(calls.map((call) => [call.canvasId, call])).values(),
  );
  const offscreen = unique.filter(({ tile: [x, y] }) => x >= 1200 || y >= 800);
  expect(unique.length).toBe(4);
  expect(offscreen.length).toBe(2);
});
it("retains in-flight work while panning within the same neighborhood", async () => {
  const w = worker(true);
  await act(async () =>
    root.render(
      <PDFTileLayer
        workerService={w as unknown as PDFWorkerService}
        page={page}
        scale={1}
        isInView
        isRendered={false}
      />,
    ),
  );
  await frames(3);
  const before = w.renderPage.mock.calls.length;
  const oldSignals = w.renderPage.mock.calls
    .map(([call]) => call.signal)
    .filter((signal) => !signal.aborted);
  pageLeft = -256;
  await act(async () => host.dispatchEvent(new Event("scroll")));
  await frames(3);
  expect(oldSignals).toHaveLength(2);
  expect(oldSignals.some((s) => s.aborted)).toBe(false);
  expect(w.renderPage.mock.calls.length).toBe(before);
});
it("debounces rapid zoom after an initial tile-only render", async () => {
  const w = worker();
  const draw = async (scale: number) => {
    pageScale = scale;
    await act(async () =>
      root.render(
        <PDFCanvasLayer
          workerService={w as unknown as PDFWorkerService}
          page={page}
          scale={scale}
          isInView
        />,
      ),
    );
  };
  await draw(1);
  await frames();
  w.renderPage.mockClear();
  await draw(1.1);
  await frames(1);
  await draw(1.2);
  await frames(1);
  const scales = Array.from(
    new Set(
      w.renderPage.mock.calls.map(
        ([c]) => (c as unknown as { scale: number }).scale,
      ),
    ),
  );
  expect(scales).toEqual([]);
  await frames(9);
  expect(
    new Set(
      w.renderPage.mock.calls.map(
        ([call]) => (call as unknown as { scale: number }).scale,
      ),
    ),
  ).toEqual(new Set([1.2]));
});
it("checks the same rapid zoom is debounced after a full-page render", async () => {
  const regularPage = {
    ...page,
    width: 600,
    height: 800,
    viewBox: [0, 0, 600, 800] as [number, number, number, number],
  };
  const w = worker();
  const draw = async (scale: number) => {
    await act(async () =>
      root.render(
        <PDFCanvasLayer
          workerService={w as unknown as PDFWorkerService}
          page={regularPage}
          scale={scale}
          isInView
        />,
      ),
    );
  };
  await draw(1);
  await frames();
  w.renderPage.mockClear();
  await draw(1.1);
  await frames(1);
  await draw(1.2);
  await frames(1);
  expect(w.renderPage).not.toHaveBeenCalled();
  await frames(9);
  const scales = w.renderPage.mock.calls.map(
    ([c]) => (c as unknown as { scale: number }).scale,
  );
  expect(scales).toEqual([1.2]);
});

it("evicts distant canvases and renders them into fresh canvases when revisited", async () => {
  const w = worker();
  await act(async () =>
    root.render(
      <PDFTileLayer
        workerService={w as unknown as PDFWorkerService}
        page={page}
        scale={1}
        isInView
        isRendered={false}
      />,
    ),
  );
  await frames();
  const originalCanvas = pageEl.querySelector("canvas");
  const initialCalls = w.renderPage.mock.calls.length;
  pageLeft = -6000;
  await act(async () => host.dispatchEvent(new Event("scroll")));
  await frames();
  expect(originalCanvas?.isConnected).toBe(false);
  expect(w.releaseCanvas).toHaveBeenCalled();
  expect(pageEl.querySelectorAll("canvas").length).toBeLessThan(20);
  const callsAfterPan = w.renderPage.mock.calls.length;
  expect(callsAfterPan).toBeGreaterThan(initialCalls);
  pageLeft = 0;
  await act(async () => host.dispatchEvent(new Event("scroll")));
  await frames();
  expect(w.renderPage.mock.calls.length).toBeGreaterThan(callsAfterPan);
  expect(pageEl.querySelector("canvas")).not.toBe(originalCanvas);
  expect(
    Array.from(pageEl.querySelectorAll("canvas")).some(
      (c) => c.dataset.rendered === "1",
    ),
  ).toBe(true);
});

it("completes the viewport without waiting for the entire page", async () => {
  const w = worker();
  const stateChanged = vi.fn();
  await act(async () =>
    root.render(
      <PDFTileLayer
        workerService={w as unknown as PDFWorkerService}
        page={page}
        scale={1}
        isInView
        isRendered={false}
        onStateChange={stateChanged}
      />,
    ),
  );
  await frames();
  expect(stateChanged).toHaveBeenLastCalledWith(
    expect.objectContaining({
      tileMode: true,
      hasUsableTileBuffer: true,
      hasVisibleTilesRendered: true,
    }),
  );
  expect(w.renderPage.mock.calls.length).toBeLessThan(96);
});

it("renders restored high zoom when its worker becomes available", async () => {
  const w = worker();
  const draw = async (service: PDFWorkerService | null) => {
    await act(async () =>
      root.render(
        <PDFTileLayer
          workerService={service}
          page={page}
          scale={1}
          isInView
          isRendered={false}
        />,
      ),
    );
  };
  await draw(null);
  await frames(2);
  await draw(w as unknown as PDFWorkerService);
  await frames();
  expect(w.renderPage).toHaveBeenCalled();
  expect(
    Array.from(pageEl.querySelectorAll("canvas")).some(
      (c) => c.dataset.rendered === "1",
    ),
  ).toBe(true);
});

it("keeps the thumbnail behind partial tiles until the viewport is covered", async () => {
  const w = worker();
  const pending: Array<(ok: boolean) => void> = [];
  w.renderPage.mockImplementation(
    ({ signal }) =>
      new Promise<boolean>((resolve) => {
        pending.push(resolve);
        signal.addEventListener("abort", () => resolve(false), { once: true });
      }),
  );
  await act(async () =>
    root.render(
      <PDFCanvasLayer
        workerService={w as unknown as PDFWorkerService}
        page={page}
        scale={1}
        isInView
      />,
    ),
  );
  await frames(2);
  await act(async () => pending.shift()!(true));
  await frames(2);
  expect(pageEl.querySelector('canvas[data-rendered="1"]')).not.toBeNull();
  expect(pageEl.querySelector("img")).not.toBeNull();
  await act(async () => pending.shift()!(true));
  await frames(2);
  expect(pageEl.querySelector("img")).toBeNull();
});

it.each([false, true])(
  "keeps tiles until the zoomed-out page is ready (previous page buffer: %s)",
  async (hasPreviousPage) => {
    const w = worker();
    const draw = async (scale: number) => {
      pageScale = scale;
      await act(async () =>
        root.render(
          <PDFCanvasLayer
            workerService={w as unknown as PDFWorkerService}
            page={page}
            scale={scale}
            isInView
          />,
        ),
      );
    };
    if (hasPreviousPage) {
      await draw(0.3);
      await frames();
    }
    await draw(1);
    await frames(15);
    const renderedTiles = Array.from(
      pageEl.querySelectorAll<HTMLCanvasElement>('canvas[data-rendered="1"]'),
    );
    expect(renderedTiles.length).toBeGreaterThan(0);
    let completePage!: (ok: boolean) => void;
    w.renderPage.mockImplementation(
      () => new Promise<boolean>((resolve) => (completePage = resolve)),
    );
    await draw(0.4);
    await frames(12);
    expect(completePage).toBeTypeOf("function");
    expect(
      renderedTiles.some(
        (tile) => tile.isConnected && tile.style.display !== "none",
      ),
    ).toBe(true);
    // Zooming out reveals areas outside the retained tiles. Keep a full-page
    // fallback behind them until the new page raster is ready.
    if (!hasPreviousPage) expect(pageEl.querySelector("img")).not.toBeNull();
    await act(async () => completePage(true));
    await frames();
    expect(renderedTiles.every((tile) => !tile.isConnected)).toBe(true);
    expect(pageEl.querySelector("img")).toBeNull();
  },
);
