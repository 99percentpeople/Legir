import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useScrollbarWidthOffset } from "@/hooks/useScrollbarWidthOffset";

let host: HTMLDivElement;
let scrollElement: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let result: ReturnType<typeof useScrollbarWidthOffset>;
let mutations: (() => void)[];
let resizes: (() => void)[];
let frames: Map<number, FrameRequestCallback>;
let sequence: number;
let systemWidth: number;
let probes: number;
let geometryReads: number;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  scrollElement = document.createElement("div");
  document.body.append(host, scrollElement);
  root = createRoot(host);
  mutations = [];
  resizes = [];
  frames = new Map();
  sequence = 0;
  systemWidth = 0;
  probes = 0;
  geometryReads = 0;
  Object.defineProperties(scrollElement, {
    scrollHeight: {
      configurable: true,
      get: () => {
        geometryReads++;
        return 2000;
      },
    },
    clientHeight: { configurable: true, value: 600 },
    scrollWidth: { configurable: true, value: 2000 },
    clientWidth: { configurable: true, value: 800 },
    offsetWidth: { configurable: true, value: 800 },
    offsetHeight: { configurable: true, value: 600 },
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      if (this.style.overflow === "scroll") probes++;
      return 100;
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    () => 100 - systemWidth,
  );
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback: () => void) {
        mutations.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resizes.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  scrollElement.remove();
  vi.unstubAllGlobals();
});

function Probe(props: { enabled?: boolean; axis?: "x" | "y" } = {}) {
  result = useScrollbarWidthOffset({ scrollElement, ...props });
  return null;
}
const render = (props: React.ComponentProps<typeof Probe> = {}) =>
  act(async () => root.render(<Probe {...props} />));
const flushFrame = () =>
  act(async () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });

it("coalesces PDF DOM mutations and reuses even a zero-width system scrollbar probe", async () => {
  await render();
  expect(result.hasScrollbar).toBe(true);
  expect(result.scrollbarWidthPx).toBe(16);
  const readsBefore = geometryReads;
  await act(async () => {
    for (let i = 0; i < 100; i++) mutations.forEach((callback) => callback());
    resizes.forEach((callback) => callback());
  });
  expect(geometryReads).toBe(readsBefore);
  await flushFrame();
  expect(geometryReads - readsBefore).toBe(1);
  expect(probes).toBe(1);
});

it("refreshes the system width after a window resize and detects overflow disappearing", async () => {
  systemWidth = 12;
  await render();
  expect(result.scrollbarWidthPx).toBe(12);
  systemWidth = 18;
  await act(async () => window.dispatchEvent(new Event("resize")));
  await flushFrame();
  expect(result.scrollbarWidthPx).toBe(18);
  Object.defineProperty(scrollElement, "scrollHeight", {
    configurable: true,
    value: 500,
  });
  await act(async () => mutations.forEach((callback) => callback()));
  await flushFrame();
  expect(result.hasScrollbar).toBe(false);
  expect(result.scrollbarWidthPx).toBe(0);
});

it("does not observe disabled offsets and cancels pending measurements on disable", async () => {
  await render({ enabled: false });
  expect(mutations).toHaveLength(0);
  expect(resizes).toHaveLength(0);
  await render();
  await act(async () => mutations.forEach((callback) => callback()));
  expect(frames.size).toBe(1);
  await render({ enabled: false });
  expect(frames.size).toBe(0);
  expect(result.scrollbarWidthPx).toBe(0);
});

it.each(["x", "y"] as const)(
  "uses the actual %s scrollbar thickness without a system probe",
  async (axis) => {
    Object.defineProperty(
      scrollElement,
      axis === "x" ? "offsetHeight" : "offsetWidth",
      {
        configurable: true,
        value: axis === "x" ? 614 : 814,
      },
    );
    await render({ axis });
    expect(result.scrollbarWidthPx).toBe(14);
    expect(probes).toBe(0);
  },
);
