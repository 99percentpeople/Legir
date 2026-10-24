import React, { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTextLayerSelection } from "@/components/workspace/hooks/useTextLayerSelection";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let renders: number;
let pageTop: number;
let selection: ReturnType<typeof useTextLayerSelection>;
const rangeRect = () => new DOMRect(100, 200, 30, 18);

function Page({ index, selectMode }: { index: number; selectMode: boolean }) {
  const textLayerRef = useRef<HTMLDivElement>(null);
  const result = useTextLayerSelection({
    pageIndex: index,
    textLayerRef,
    isSelectMode: selectMode,
    scale: 1,
    renderedScale: 1,
    isInView: true,
  });
  if (index === 0) selection = result;
  renders++;
  return (
    <div id={`page-${index}`}>
      <div ref={textLayerRef} className="textLayer">
        <span role="presentation">Selectable PDF text</span>
      </div>
    </div>
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  renders = 0;
  pageTop = 20;
  window.getSelection()?.removeAllRanges();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.id.startsWith("page-")
        ? new DOMRect(10, pageTop, 400, 600)
        : rangeRect();
    },
  );
  Object.defineProperties(Range.prototype, {
    getBoundingClientRect: { configurable: true, value: rangeRect },
    getClientRects: { configurable: true, value: () => [rangeRect()] },
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  window.getSelection()?.removeAllRanges();
  host.remove();
  Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  Reflect.deleteProperty(Range.prototype, "getClientRects");
  vi.unstubAllGlobals();
});

const renderPages = (selectMode = true) =>
  act(async () => {
    root.render(
      <>
        {Array.from({ length: 12 }, (_, index) => (
          <Page key={index} index={index} selectMode={selectMode} />
        ))}
      </>,
    );
  });

const scroll = () => act(async () => host.dispatchEvent(new Event("scroll")));

it.each([true, false])(
  "does not render idle text layers on viewport/sidebar scroll (select mode: %s)",
  async (selectMode) => {
    await renderPages(selectMode);
    const before = renders;
    // Separate events model separate animation frames, not one React batch.
    for (let i = 0; i < 20; i++) await scroll();
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(renders).toBe(before);
    expect(selection.selectionHandles).toEqual({ start: null, end: null });
  },
);

it("keeps selected text handles aligned during scroll, then stops updating after clearing", async () => {
  await renderPages();
  const text = host.querySelector("#page-0 span")!.firstChild!;
  const range = document.createRange();
  range.setStart(text, 1);
  range.setEnd(text, 6);
  await act(async () => {
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  const originalTop = selection.selectionHandles.start!.top;
  expect(selection.selectionHandles.end).not.toBeNull();
  const beforeScroll = renders;
  pageTop += 30;
  await scroll();
  expect(selection.selectionHandles.start!.top).toBe(originalTop - 30);
  expect(renders - beforeScroll).toBe(1);

  await act(async () => {
    window.getSelection()!.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
  });
  expect(selection.selectionHandles).toEqual({ start: null, end: null });
  const afterClear = renders;
  await scroll();
  expect(renders).toBe(afterClear);
});
