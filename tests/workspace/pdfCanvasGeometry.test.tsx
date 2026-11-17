import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cropPageGeometry,
  resetPageCrop,
  resizePageGeometry,
} from "@legir/pdf-model/pageGeometry";
import type { PageData } from "@/types";
import PDFCanvasLayer from "@/components/workspace/layers/PDFCanvasLayer";
import { getPageView } from "@/components/workspace/lib/pageViewRotation";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { useEditorView } from "@/store/useEditorView";

const source: PageData = {
  pageIndex: 0,
  width: 400,
  height: 600,
  viewBox: [0, 0, 400, 600],
  rotation: 0,
  userUnit: 1,
};
const crop = (page: PageData): PageData => ({
  ...page,
  geometry: cropPageGeometry(page, {
    top: 10,
    right: 0,
    bottom: 0,
    left: 10,
  }),
});
const worker = () => ({
  renderPage: vi.fn(async () => true),
  renderPageImage: vi.fn(async () => ({
    bytes: new Uint8Array(),
    mimeType: "image/jpeg",
  })),
  releaseCanvas: vi.fn(async () => true),
});
const frames = async () => {
  for (let i = 0; i < 5; i++) {
    await act(async () => vi.advanceTimersByTimeAsync(20));
  }
};
let host: HTMLDivElement;
let root: Root;
const transferred = new Set<HTMLCanvasElement>();
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  transferred.clear();
  Object.defineProperty(
    HTMLCanvasElement.prototype,
    "transferControlToOffscreen",
    {
      configurable: true,
      value: function (this: HTMLCanvasElement) {
        if (transferred.has(this))
          throw new DOMException(
            "Canvas already transferred",
            "InvalidStateError",
          );
        transferred.add(this);
        // Match the browser: after transfer, only the worker can resize it.
        for (const dimension of ["width", "height"] as const) {
          const value = this[dimension];
          Object.defineProperty(this, dimension, {
            get: () => value,
            set: () => {
              throw new DOMException(
                "Cannot resize transferred canvas",
                "InvalidStateError",
              );
            },
          });
        }
        return {};
      },
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>)
    .transferControlToOffscreen;
});
const draw = async (
  page: PageData,
  w: ReturnType<typeof worker>,
  strict = false,
) => {
  await act(async () => {
    useEditorView.setState({ pages: [page], pagePreviewImages: {} });
    const layer = (
      <PDFCanvasLayer
        workerService={w as unknown as PDFWorkerService}
        page={getPageView(page, 0)}
        scale={1}
        isInView
      />
    );
    root.render(strict ? <React.StrictMode>{layer}</React.StrictMode> : layer);
  });
  await frames();
};

it.each([false, true])(
  "finishes repeated crops, resize and crop restoration without transferring a canvas twice (StrictMode=%s)",
  async (strict) => {
    const w = worker();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = crop(source);
    const second = crop(first);
    const third = crop(second);
    const resized = {
      ...third,
      geometry: resizePageGeometry(third, {
        width: 500,
        height: 700,
        content: "fit",
        anchorX: 0.5,
        anchorY: 0.5,
      }),
    };
    await draw(first, w, strict);
    const canvases = [...host.querySelectorAll("canvas")];
    expect(w.renderPage).toHaveBeenCalledOnce();
    expect(host.querySelector(".animate-spin")).toBeNull();
    // StrictMode replays the initial cleanup before any canvas is transferred.
    w.releaseCanvas.mockClear();
    let renders = 1;
    for (const page of [
      second,
      third,
      resized,
      { ...third, geometry: resetPageCrop(third) },
      third,
      second,
      first,
    ]) {
      await draw(page, w, strict);
      expect(w.renderPage).toHaveBeenCalledTimes(++renders);
      expect(host.querySelector(".animate-spin")).toBeNull();
      expect([...host.querySelectorAll("canvas")]).toEqual(canvases);
    }
    expect(transferred.size).toBe(2);
    expect(w.releaseCanvas).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  },
);

it("creates fresh canvas elements when the rendering worker changes", async () => {
  const first = worker();
  const second = worker();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await draw(source, first);
  const oldCanvases = [...host.querySelectorAll("canvas")];
  await draw(source, second);
  expect(first.releaseCanvas).toHaveBeenCalledOnce();
  expect(second.renderPage).toHaveBeenCalledOnce();
  expect(host.querySelector(".animate-spin")).toBeNull();
  expect(oldCanvases.every((canvas) => !canvas.isConnected)).toBe(true);
  expect(error).not.toHaveBeenCalled();
});
