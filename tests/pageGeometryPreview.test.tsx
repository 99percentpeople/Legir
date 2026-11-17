import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PageData } from "@legir/pdf-model";
import type { ThumbnailContent } from "@legir/pdf-core/types";
import { resizePageGeometry } from "@legir/pdf-model/pageGeometry";
import { PageGeometryPreview } from "@/components/page-editor/PageGeometryPreview";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";

vi.mock("@/components/language-provider", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const portrait: PageData = {
  pageIndex: 0,
  width: 400,
  height: 600,
  viewBox: [0, 0, 400, 600],
  userUnit: 1,
  rotation: 0,
};
const resized = (width: number, height: number): PageData => ({
  ...portrait,
  geometry: resizePageGeometry(portrait, {
    width,
    height,
    content: "original",
    anchorX: 0.5,
    anchorY: 0.5,
  }),
});
const content: ThumbnailContent = {
  width: 400,
  height: 600,
  fields: [],
  annotations: [],
  preserved: [],
};
type RenderResult = { bytes: Uint8Array; mimeType: string };
let host: HTMLDivElement;
let root: Root;
let worker: PDFWorkerService;
let requests: ReturnType<typeof deferred<RenderResult>>[];
let decodes: ReturnType<typeof deferred<void>>[];
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  requests = [];
  decodes = [];
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode() {
        const pending = deferred<void>();
        decodes.push(pending);
        return pending.promise;
      }
    },
  );
  worker = {
    renderPageImage: vi.fn(() => {
      const pending = deferred<RenderResult>();
      requests.push(pending);
      return pending.promise;
    }),
  } as unknown as PDFWorkerService;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const paper = () =>
  host.querySelector<HTMLElement>("[data-page-geometry-preview]")!;
const src = () => host.querySelector("img")?.getAttribute("src");
async function render(page: PageData) {
  await act(async () =>
    root.render(
      <PageGeometryPreview page={page} worker={worker} content={content} />,
    ),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(80);
  });
}
async function finishRender(index: number) {
  await act(async () =>
    requests[index].resolve({
      bytes: new Uint8Array([index + 1]),
      mimeType: "image/png",
    }),
  );
}
async function finishDecode(index: number) {
  await act(async () => decodes[index].resolve());
}
async function firstPreview() {
  await render(portrait);
  await finishRender(0);
  await finishDecode(0);
}

it("keeps the old paper and bitmap together until the replacement image is decoded", async () => {
  await firstPreview();
  const previousSrc = src();
  const previousRatio = paper().style.aspectRatio;
  await render(resized(600, 400));
  expect(src()).toBe(previousSrc);
  expect(paper().style.aspectRatio).toBe(previousRatio);
  expect(paper().getAttribute("aria-busy")).toBe("true");
  await finishRender(1);
  expect(src()).toBe(previousSrc);
  expect(paper().style.aspectRatio).toBe(previousRatio);
  await finishDecode(1);
  expect(src()).not.toBe(previousSrc);
  expect(parseFloat(paper().style.aspectRatio)).toBe(1.5);
  expect(paper().getAttribute("aria-busy")).toBe("false");
});

it("discards a superseded image even if its decode finishes after the current preview", async () => {
  await firstPreview();
  await render(resized(600, 400));
  await finishRender(1);
  await render(resized(600, 600));
  await finishRender(2);
  await finishDecode(2);
  const latestSrc = src();
  expect(parseFloat(paper().style.aspectRatio)).toBe(1);
  await finishDecode(1);
  expect(src()).toBe(latestSrc);
  expect(parseFloat(paper().style.aspectRatio)).toBe(1);
  expect(paper().getAttribute("aria-busy")).toBe("false");
});

it("retains the last valid preview when replacement decoding fails", async () => {
  await firstPreview();
  const previousSrc = src();
  const previousRatio = paper().style.aspectRatio;
  await render(resized(600, 400));
  await finishRender(1);
  await act(async () => decodes[1].reject(new Error("decode failed")));
  expect(src()).toBe(previousSrc);
  expect(paper().style.aspectRatio).toBe(previousRatio);
  expect(paper().getAttribute("aria-busy")).toBe("false");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "page_editor.geometry.preview_failed",
  );
});
