import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASCIIFluidEngine } from "../../www/src/components/hero-background/field/engine.js";
import { mountHeroTide } from "../../www/src/components/hero-background/runtime";
import type { HeroBackgroundController } from "../../www/src/components/hero-background/types";

const engine = vi.hoisted(() => ({
  resize: vi.fn(),
  setStyle: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("../../www/src/components/hero-background/field/engine.js", () => ({
  ASCIIFluidEngine: vi.fn(function () {
    return engine;
  }),
}));

describe("hero background lifecycle", () => {
  let canvas: HTMLCanvasElement;
  let controller: HeroBackgroundController | undefined;
  let motion: EventTarget & { matches: boolean };
  let onIntersection: IntersectionObserverCallback;
  let onResize: ResizeObserverCallback;
  let intersectionDisconnect: ReturnType<typeof vi.fn>;
  let resizeDisconnect: ReturnType<typeof vi.fn>;
  let hidden = false;
  let box: DOMRect;
  let frames: Map<number, FrameRequestCallback>;
  const status = vi.fn();
  const intersect = (isIntersecting: boolean) =>
    onIntersection(
      [{ isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((fn) => fn(0));
  };
  beforeEach(() => {
    vi.clearAllMocks();
    canvas = document.createElement("canvas");
    canvas.style.setProperty("--site-bg", "#ffffff");
    document.body.append(canvas);
    box = new DOMRect(0, 76, 1440, 500);
    vi.spyOn(canvas, "getBoundingClientRect").mockImplementation(() => box);
    hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    motion = Object.assign(new EventTarget(), { matches: false });
    vi.stubGlobal("matchMedia", () => motion);
    resizeDisconnect = vi.fn();
    intersectionDisconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          onResize = callback;
        }
        observe() {}
        disconnect = resizeDisconnect;
      },
    );
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          onIntersection = callback;
        }
        observe() {}
        disconnect = intersectionDisconnect;
      },
    );
    frames = new Map();
    let id = 0;
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
      frames.set(++id, fn);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (value: number) =>
      frames.delete(value),
    );
    vi.stubGlobal("devicePixelRatio", 3);
    document.documentElement.classList.remove("dark");
  });
  afterEach(() => {
    controller?.destroy();
    controller = undefined;
    canvas.remove();
    document.documentElement.classList.remove("dark");
    vi.unstubAllGlobals();
  });
  it("uses a bounded grid, capped pixel ratio, deterministic seed and quiet center", () => {
    controller = mountHeroTide(canvas, status);
    expect(ASCIIFluidEngine).toHaveBeenCalledWith(
      canvas,
      expect.objectContaining({
        quality: "low",
        paused: true,
        seed: expect.any(Number),
        config: expect.objectContaining({
          simulationHz: 20,
          renderHz: 24,
          maxSubsteps: 1,
          timeScale: 0.2,
          decay: 0.045,
          waveDye: 0.06,
        }),
        quietZone: expect.objectContaining({ strength: 0.98 }),
      }),
    );
    expect(engine.resize).toHaveBeenCalledWith(1440, 500, 1.5);
    expect(engine.resume).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith("running");
  });
  it("stops offscreen and resumes automatically without a manual pause state", () => {
    controller = mountHeroTide(canvas, status);
    intersect(false);
    expect(engine.pause).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith("suspended");
    intersect(true);
    expect(engine.resume).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenLastCalledWith("running");
    expect(Object.keys(controller)).toEqual(["destroy"]);
  });
  it("stops for hidden tabs and resumes when the tab becomes visible", () => {
    controller = mountHeroTide(canvas, status);
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(status).toHaveBeenLastCalledWith("suspended");
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(status).toHaveBeenLastCalledWith("running");
    expect(engine.pause).toHaveBeenCalledTimes(1);
    expect(engine.resume).toHaveBeenCalledTimes(2);
  });
  it("renders a still image for reduced motion and handles live preference changes", () => {
    motion.matches = true;
    controller = mountHeroTide(canvas, status);
    expect(engine.resize).toHaveBeenCalled();
    expect(engine.resume).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith("still");
    motion.matches = false;
    motion.dispatchEvent(new Event("change"));
    expect(engine.resume).toHaveBeenCalledTimes(1);
    motion.matches = true;
    motion.dispatchEvent(new Event("change"));
    expect(engine.pause).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith("still");
  });
  it("updates the palette in place without restarting a paused field", async () => {
    controller = mountHeroTide(canvas, status);
    motion.matches = true;
    motion.dispatchEvent(new Event("change"));
    canvas.style.setProperty("--site-bg", "#0a0a0a");
    document.documentElement.classList.add("dark");
    await Promise.resolve();
    expect(engine.setStyle).toHaveBeenLastCalledWith(
      expect.objectContaining({
        background: "#0a0a0a",
        colors: expect.arrayContaining([[1, "#dfa09a"]]),
      }),
    );
    expect(ASCIIFluidEngine).toHaveBeenCalledTimes(1);
    expect(engine.resume).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith("still");
  });
  it("coalesces resize updates and uses one device pixel per CSS pixel on phones", () => {
    controller = mountHeroTide(canvas, status);
    box = new DOMRect(0, 64, 390, 450);
    onResize([], {} as ResizeObserver);
    onResize([], {} as ResizeObserver);
    expect(frames.size).toBe(1);
    flushFrames();
    expect(engine.resize).toHaveBeenLastCalledWith(390, 450, 1);
  });
  it("cleans up queued work and ignores late events after destruction", async () => {
    controller = mountHeroTide(canvas, status);
    onResize([], {} as ResizeObserver);
    controller.destroy();
    controller.destroy();
    expect(frames.size).toBe(0);
    expect(engine.destroy).toHaveBeenCalledTimes(1);
    expect(resizeDisconnect).toHaveBeenCalledTimes(1);
    expect(intersectionDisconnect).toHaveBeenCalledTimes(1);
    const count = status.mock.calls.length;
    intersect(false);
    document.dispatchEvent(new Event("visibilitychange"));
    motion.dispatchEvent(new Event("change"));
    document.documentElement.classList.add("dark");
    await Promise.resolve();
    expect(status).toHaveBeenCalledTimes(count);
  });
  it("releases the engine when Canvas initialization fails", () => {
    engine.resize.mockImplementationOnce(() => {
      throw new Error("Canvas unavailable");
    });
    expect(() => mountHeroTide(canvas, status)).toThrow("Canvas unavailable");
    expect(engine.destroy).toHaveBeenCalledTimes(1);
  });
});
