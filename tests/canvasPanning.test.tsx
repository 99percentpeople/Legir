import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCanvasPanning } from "@/hooks/useCanvasPanning";

let root: Root;
let host: HTMLDivElement;
let api: ReturnType<typeof useCanvasPanning>;
let container: HTMLDivElement;
let nextId: number;
const frames = new Map<number, FrameRequestCallback>();
const release = vi.fn();
function Reader() {
  const ref = useRef<HTMLDivElement>(null);
  api = useCanvasPanning({
    containerRef: ref,
    editorState: { tool: "pan", keys: { space: false } },
    capturePointer: vi.fn(),
    releasePointer: release,
  });
  return <div ref={ref} />;
}
const pointer = (y: number) =>
  ({
    button: 0,
    clientX: 100,
    clientY: y,
    preventDefault: vi.fn(),
  }) as unknown as React.PointerEvent;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames.clear();
  nextId = 0;
  release.mockClear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Reader />));
  container = host.firstElementChild as HTMLDivElement;
  container.scrollTop = 100;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("applies the latest pointer position when released before the queued frame", async () => {
  await act(async () => {
    api.startPan(pointer(700));
  });
  api.movePan(pointer(650));
  api.movePan(pointer(500));
  expect(frames.size).toBe(1);
  expect(container.scrollTop).toBe(100);
  await act(async () => {
    api.endPan(pointer(500));
  });
  expect(container.scrollTop).toBe(300);
  expect(frames.size).toBe(0);
  expect(release).toHaveBeenCalledOnce();
  expect(api.isPanning).toBe(false);
});

it("coalesces movement into one frame and cancels pending work when the reader unmounts", async () => {
  await act(async () => {
    api.startPan(pointer(700));
  });
  for (let y = 699; y >= 600; y--) api.movePan(pointer(y));
  expect(frames.size).toBe(1);
  await act(async () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
  expect(container.scrollTop).toBe(200);
  api.movePan(pointer(550));
  await act(async () => root.render(null));
  expect(frames.size).toBe(0);
  expect(container.scrollTop).toBe(200);
});
