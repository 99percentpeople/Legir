import React, { act, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VirtualizedPages } from "@/components/workspace/VirtualizedPages";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let frames: Map<number, FrameRequestCallback>;
let sequence: number;
let peakMounted: number;
let resized: (() => void) | undefined;
const items = Array.from({ length: 1000 }, (_, index) => index);
const rects = items.map((index) => ({
  top: index * 1020,
  bottom: index * 1020 + 1000,
  left: index * 1020,
  right: index * 1020 + 1000,
  width: 1000,
  height: 1000,
}));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  frames = new Map();
  sequence = 0;
  peakMounted = 0;
  resized = undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function Page({ index }: { index: number }) {
  useLayoutEffect(() => {
    peakMounted = Math.max(
      peakMounted,
      host.querySelectorAll("[data-page]").length,
    );
  });
  return <input data-page={index} defaultValue={`Page ${index}`} />;
}

function Harness({
  pinIndex = 0,
  axis = "vertical",
  count = 1000,
  enabled = true,
}: {
  pinIndex?: number | null;
  axis?: "vertical" | "horizontal";
  count?: number;
  enabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={containerRef} data-scroll>
      <VirtualizedPages
        enabled={enabled}
        containerRef={containerRef}
        axis={axis}
        overscan={5}
        pinIndex={pinIndex}
        items={items.slice(0, count)}
        rects={rects.slice(0, count)}
        getKey={(index) => index}
        renderItem={(index) => <Page index={index} />}
      />
    </div>
  );
}

const render = (props: React.ComponentProps<typeof Harness> = {}) =>
  act(async () => root.render(<Harness {...props} />));
const flushFrame = () =>
  act(async () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
const mounted = () =>
  [...host.querySelectorAll<HTMLElement>("[data-page]")].map((el) =>
    Number(el.dataset.page),
  );

it("bounds mounted pages from the first commit, before any animation frame", async () => {
  await render();
  expect(peakMounted).toBeLessThanOrEqual(6);
  expect(mounted()).toEqual([0, 1, 2, 3, 4, 5]);
});

it.each(["vertical", "horizontal"] as const)(
  "keeps a distant pinned page without mounting the intervening pages (%s)",
  async (axis) => {
    await render({ axis });
    await flushFrame();
    const pinned = host.querySelector<HTMLInputElement>('[data-page="0"]')!;
    pinned.value = "unsaved draft";
    pinned.focus();
    const container = host.querySelector<HTMLElement>("[data-scroll]")!;
    container[axis === "vertical" ? "scrollTop" : "scrollLeft"] = 900 * 1020;
    container.dispatchEvent(new Event("scroll"));
    await flushFrame();
    expect(mounted()).toEqual([0, ...items.slice(895, 906)]);
    expect(host.querySelector('[data-page="0"]')).toBe(pinned);
    expect(document.activeElement).toBe(pinned);
    expect(pinned.value).toBe("unsaved draft");
    await render({ axis, pinIndex: 900 });
    await flushFrame();
    expect(mounted()).toEqual(items.slice(895, 906));
  },
);

it("updates the visible window when the scroll container is resized", async () => {
  await render();
  await flushFrame();
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(3000);
  expect(resized).toBeTypeOf("function");
  resized?.();
  await flushFrame();
  expect(mounted()).toEqual(items.slice(0, 8));
});

it("handles empty documents and disabled virtualization", async () => {
  await render({ count: 0 });
  await flushFrame();
  expect(mounted()).toEqual([]);
  await render({ count: 20, enabled: false });
  expect(mounted()).toEqual(items.slice(0, 20));
});
