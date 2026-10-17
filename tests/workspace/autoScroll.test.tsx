import React, { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useAutoScroll } from "@/hooks/useAutoScroll";

it("reuses viewport bounds during motion and refreshes them on layout changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  let resize: () => void;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Probe({ enabled }: { enabled: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useAutoScroll(ref, { enabled });
    return <div ref={ref} />;
  }
  const tick = () =>
    act(async () => {
      const jobs = [...frames.values()];
      frames.clear();
      jobs.forEach((job) => job(0));
    });
  try {
    await act(async () => root.render(<Probe enabled />));
    const viewport = host.firstElementChild as HTMLElement;
    const bounds = vi
      .spyOn(viewport, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(100, 100, 400, 400));
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 300, clientY: 490 }),
    );
    await tick();
    await tick();
    await tick();
    expect(viewport.scrollTop).toBe(48);
    expect(bounds).toHaveBeenCalledTimes(1);
    viewport.dispatchEvent(new Event("scroll"));
    await tick();
    expect(bounds).toHaveBeenCalledTimes(1);
    bounds.mockReturnValue(new DOMRect(100, 100, 400, 700));
    resize!();
    await tick();
    expect(bounds).toHaveBeenCalledTimes(2);
    expect(viewport.scrollTop).toBe(64);
    window.dispatchEvent(new Event("scroll"));
    await tick();
    expect(bounds).toHaveBeenCalledTimes(3);
    await act(async () => root.render(<Probe enabled={false} />));
    expect(frames.size).toBe(0);
    expect(disconnect).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
