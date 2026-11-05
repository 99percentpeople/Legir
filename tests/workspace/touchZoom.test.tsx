import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useViewportTouchGestures } from "@/hooks/useViewportTouchGestures";
import { getPreviewDoubleTapTarget } from "@/components/workspace/lib/previewTouchZoom";
import { dispatchTouches, touch } from "../helpers/touch";

let root: Root;
let host: HTMLDivElement;
let viewport: HTMLDivElement;
const zoom = vi.fn(),
  begin = vi.fn(),
  active = vi.fn(),
  doubleTap = vi.fn(),
  pan = vi.fn();
let suppressClick: () => boolean;
type Options = Partial<Parameters<typeof useViewportTouchGestures>[0]>;
const ref = { current: null as HTMLElement | null };
function Probe({ options }: { options: Options }) {
  const result = useViewportTouchGestures({
    containerRef: ref,
    enabled: true,
    scale: 1,
    minScale: 0.5,
    maxScale: 2,
    panEnabled: false,
    onPinchZoom: zoom,
    onPinchBegin: begin,
    onPinchStateChange: active,
    onPinchPan: pan,
    getDoubleTapTarget: (target) => (target === viewport ? viewport : null),
    onDoubleTap: doubleTap,
    ...options,
  });
  suppressClick = result.shouldSuppressClick;
  return null;
}
const mount = (options: Options = {}) =>
  act(async () => root.render(<Probe options={options} />));
const finger = (id: number, x: number, y = 100) => touch(viewport, id, x, y);
const send = (type: string, points: Touch[], changed = points) =>
  dispatchTouches(viewport, type, points, changed);
const tap = (x = 100) => {
  const point = finger(1, x);
  send("touchstart", [point]);
  return send("touchend", [], [point]);
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  viewport = document.createElement("div");
  document.body.append(host, viewport);
  ref.current = viewport;
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  viewport.remove();
  document.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});

it("keeps a pinch continuous across renders and reports midpoint movement at both scale limits", async () => {
  await mount();
  send("touchstart", [finger(1, 100), finger(2, 200)]);
  send("touchmove", [finger(1, 100), finger(2, 250)]);
  expect(zoom).toHaveBeenLastCalledWith({
    clientX: 175,
    clientY: 100,
    newScale: 1.5,
  });
  await mount({ scale: 1.5 });
  send("touchmove", [finger(1, 100), finger(2, 500)]);
  expect(zoom).toHaveBeenLastCalledWith({
    clientX: 300,
    clientY: 100,
    newScale: 2,
  });
  send("touchmove", [finger(1, 100), finger(2, 600)]);
  expect(zoom).toHaveBeenLastCalledWith({
    clientX: 350,
    clientY: 100,
    newScale: 2,
  });
  send("touchmove", [finger(1, 100), finger(2, 110)]);
  expect(zoom).toHaveBeenLastCalledWith({
    clientX: 105,
    clientY: 100,
    newScale: 0.5,
  });
  expect(begin).toHaveBeenCalledTimes(1);
  expect(pan).not.toHaveBeenCalled();
  send("touchend", [finger(1, 100)], [finger(2, 110)]);
  expect(active).toHaveBeenLastCalledWith(true);
  expect(suppressClick()).toBe(true);
  send("touchend", [], [finger(1, 100)]);
  expect(active).toHaveBeenLastCalledWith(false);
  expect(suppressClick()).toBe(true);
});

it("ignores outside fingers and disabled editors, and cancels a gesture without a tap", async () => {
  await mount();
  const outside = touch(host, 2, 200, 100);
  send("touchstart", [finger(1, 100)]);
  dispatchTouches(host, "touchstart", [finger(1, 100), outside], [outside]);
  send("touchmove", [finger(1, 100), outside]);
  expect(begin).not.toHaveBeenCalled();
  send("touchstart", [finger(1, 100), finger(3, 200)], [finger(3, 200)]);
  send("touchcancel", [finger(1, 100)], [finger(3, 200)]);
  expect(active).toHaveBeenLastCalledWith(false);
  send("touchend", [], [finger(1, 100)]);
  tap();
  expect(doubleTap).not.toHaveBeenCalled();
  await mount({ enabled: false });
  send("touchstart", [finger(1, 100), finger(2, 200)]);
  send("touchmove", [finger(1, 100), finger(2, 300)]);
  expect(zoom).not.toHaveBeenCalled();
});

it("leaves one-finger scrolling native when requested and can veto pinch during sorting", async () => {
  await mount({ canStartPinch: () => false });
  expect(send("touchstart", [finger(1, 100)]).defaultPrevented).toBe(false);
  expect(send("touchmove", [finger(1, 100, 200)]).defaultPrevented).toBe(false);
  send("touchstart", [finger(1, 100), finger(2, 200)]);
  send("touchmove", [finger(1, 100), finger(2, 300)]);
  expect(zoom).not.toHaveBeenCalled();
  expect(begin).not.toHaveBeenCalled();
  expect(pan).not.toHaveBeenCalled();
});

it("recognizes only two short nearby touch taps, preserves the first tap, and consumes the second", async () => {
  await mount();
  expect(tap().defaultPrevented).toBe(false);
  expect(tap(105).defaultPrevented).toBe(true);
  expect(doubleTap).toHaveBeenCalledExactlyOnceWith({
    clientX: 105,
    clientY: 100,
  });
  viewport.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  expect(doubleTap).toHaveBeenCalledTimes(1);
});

it.each(["move", "long-press", "late", "distant", "cancel"])(
  "rejects %s as a double tap",
  async (kind) => {
    let now = 100;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    await mount();
    tap();
    if (kind === "late") now += 301;
    const point = finger(1, kind === "distant" ? 200 : 100);
    send("touchstart", [point]);
    if (kind === "move") {
      send("touchmove", [finger(1, 130)]);
      send("touchmove", [point]);
    }
    if (kind === "long-press") now += 251;
    send(kind === "cancel" ? "touchcancel" : "touchend", [], [point]);
    expect(doubleTap).not.toHaveBeenCalled();
  },
);

it("allows preview blank-page taps but preserves text selection, controls, and editing tools", () => {
  viewport.setAttribute("data-workspace-page", "");
  viewport.innerHTML =
    '<canvas></canvas><div class="textLayer"><span>PDF text</span></div><input /><div id="annotation-1"></div><button>Action</button>';
  const state = {
    mode: "annotation",
    tool: "select",
    selectedId: null,
  } as const;
  expect(
    getPreviewDoubleTapTarget(viewport.querySelector("canvas"), state),
  ).toBe(viewport);
  expect(
    getPreviewDoubleTapTarget(viewport.querySelector(".textLayer"), state),
  ).toBe(viewport);
  for (const selector of ["span", "input", "#annotation-1", "button"])
    expect(
      getPreviewDoubleTapTarget(viewport.querySelector(selector), state),
    ).toBeNull();
  for (const patch of [
    { mode: "form" },
    { mode: "pages" },
    { tool: "draw_ink" },
    { selectedId: "annotation-1" },
  ] as const)
    expect(
      getPreviewDoubleTapTarget(viewport, { ...state, ...patch }),
    ).toBeNull();
  const range = document.createRange();
  range.selectNodeContents(viewport.querySelector("span")!);
  document.getSelection()?.addRange(range);
  expect(getPreviewDoubleTapTarget(viewport, state)).toBeNull();
});
