import React, { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWorkspaceViewport } from "@/components/workspace/hooks/useWorkspaceViewport";
import { createTestEditorStore } from "../helpers/editorStore";
import { MAX_EDITOR_SCALE, MIN_EDITOR_SCALE } from "@/constants";

let root: Root;
let host: HTMLDivElement;
let viewport: HTMLDivElement;
let content: HTMLDivElement;
let store: ReturnType<typeof createTestEditorStore>;
let frames: Map<number, FrameRequestCallback>;
const changeScale = vi.fn();
let controller: ReturnType<typeof useWorkspaceViewport>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map();
  let nextId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  host = document.createElement("div");
  viewport = document.createElement("div");
  content = document.createElement("div");
  viewport.append(content);
  document.body.append(host, viewport);
  Object.defineProperties(viewport, {
    clientHeight: { value: 800 },
    clientWidth: { value: 600 },
  });
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 600, 800),
  );
  vi.spyOn(content, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 1000, 2000),
  );
  store = createTestEditorStore({ scale: 1 });
  root = createRoot(host);
  changeScale.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  store.dispose();
  host.remove();
  viewport.remove();
  vi.unstubAllGlobals();
});

const mount = async () => {
  const containerRef = { current: viewport };
  const contentRef = { current: content };
  function Probe() {
    const editorState = useSyncExternalStore(store.subscribe, store.getState);
    controller = useWorkspaceViewport({
      containerRef,
      contentRef,
      editorState,
      onScaleChange: changeScale,
      isPanning: false,
      textSelectionToolbarVisible: false,
      updateTextSelectionToolbar: () => {},
    });
    return null;
  }
  await act(async () => root.render(<Probe />));
};
const flush = () =>
  act(async () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  });
const wheel = (init: WheelEventInit) => {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: 300,
    clientY: 300,
    ...init,
  });
  viewport.dispatchEvent(event);
  return event;
};

it.each([
  { deltaMode: 0, deltaY: -100 },
  { deltaMode: 1, deltaY: -6.25 },
  { deltaMode: 2, deltaY: -0.125 },
])(
  "normalizes modifier-wheel units ($deltaMode) and cancels browser zoom",
  async (delta) => {
    await mount();
    const event = wheel({ ...delta, ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    await flush();
    expect(changeScale).toHaveBeenCalledExactlyOnceWith(1.25);
  },
);

it("keeps ordinary wheel scrolling and accumulates rapid zoom input in one frame", async () => {
  await mount();
  expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false);
  await flush();
  expect(changeScale).not.toHaveBeenCalled();
  wheel({ ctrlKey: true, deltaY: -100 });
  wheel({ ctrlKey: true, deltaY: -100 });
  await flush();
  expect(changeScale).toHaveBeenCalledExactlyOnceWith(1.563);
});

it("keeps the initial pinch anchor across rapid inputs, later frames, and constant-scale panning", async () => {
  store.setState({ pageLayout: "single", pageFlow: "vertical" });
  changeScale.mockImplementation((scale: number) => store.setState({ scale }));
  await mount();
  controller.beginPinchZoom({ clientX: 300, clientY: 300 });
  controller.updatePinchZoom({ clientX: 300, clientY: 310, newScale: 1.25 });
  controller.updatePinchZoom({ clientX: 300, clientY: 320, newScale: 1.5 });
  await flush();
  expect(changeScale).toHaveBeenCalledExactlyOnceWith(1.5);
  // The fixed outer padding stays 32px; the original content point scales.
  expect(viewport.scrollTop).toBeCloseTo(32 + (300 - 32) * 1.5 - 320);
  controller.updatePinchZoom({ clientX: 300, clientY: 330, newScale: 2 });
  await flush();
  expect(viewport.scrollTop).toBeCloseTo(32 + (300 - 32) * 2 - 330);
  controller.updatePinchZoom({ clientX: 300, clientY: 350, newScale: 2 });
  await flush();
  expect(viewport.scrollTop).toBeCloseTo(32 + (300 - 32) * 2 - 350);
  expect(changeScale).toHaveBeenCalledTimes(2);
});

it.each([
  [-10000, MAX_EDITOR_SCALE],
  [10000, MIN_EDITOR_SCALE],
])("bounds zoom for wheel delta %s", async (deltaY, expected) => {
  await mount();
  wheel({ ctrlKey: true, deltaY });
  await flush();
  expect(changeScale).toHaveBeenCalledExactlyOnceWith(
    Number(expected.toFixed(3)),
  );
});

it("matches page-grid precision for many small wheel deltas in one frame", async () => {
  await mount();
  for (let i = 0; i < 20; i++) wheel({ ctrlKey: true, deltaY: -5 });
  await flush();
  expect(changeScale).toHaveBeenCalledExactlyOnceWith(1.25);
});
