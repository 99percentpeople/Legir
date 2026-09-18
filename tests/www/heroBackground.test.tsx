import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeroTidalBackground } from "../../www/src/components/hero-background/HeroTidalBackground";
import type { HeroBackgroundStatus } from "../../www/src/components/hero-background/types";

const adapter = vi.hoisted(() => ({
  mount: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("../../www/src/components/hero-background/runtime", () => ({
  mountHeroTide: adapter.mount,
}));

describe("optional hero background", () => {
  let root: Root;
  let container: HTMLDivElement;
  let intersection: IntersectionObserverCallback;
  let idle: IdleRequestCallback | undefined;
  const cancelIdle = vi.fn();
  const render = async () =>
    act(async () => root.render(<HeroTidalBackground />));
  const enter = async () =>
    act(async () =>
      intersection(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
  const load = async () =>
    act(async () => {
      idle?.({ didTimeout: false, timeRemaining: () => 10 });
      await vi.waitFor(() => expect(adapter.mount).toHaveBeenCalled());
    });
  beforeEach(() => {
    vi.clearAllMocks();
    idle = undefined;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getBoundingClientRect",
    ).mockReturnValue(new DOMRect(0, 76, 1440, 500));
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersection = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      idle = callback;
      return 17;
    });
    vi.stubGlobal("cancelIdleCallback", cancelIdle);
    adapter.mount.mockImplementation(
      (_canvas, report: (status: HeroBackgroundStatus) => void) => {
        report("running");
        return { destroy: adapter.destroy };
      },
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(navigator, "connection");
    vi.unstubAllGlobals();
  });
  it("waits for visibility and idle time without blocking the page", async () => {
    await render();
    expect(
      container.querySelector('[aria-hidden="true"] canvas'),
    ).not.toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(adapter.mount).not.toHaveBeenCalled();
    await enter();
    expect(adapter.mount).not.toHaveBeenCalled();
    await load();
    expect(
      container
        .querySelector(".hero-tidal-background")
        ?.getAttribute("data-status"),
    ).toBe("running");
  });
  it("stays purely decorative with no pause button or focusable controls", async () => {
    await render();
    await enter();
    await load();
    const background = container.querySelector(".hero-tidal-background")!;
    expect(background.getAttribute("aria-hidden")).toBe("true");
    expect(background.querySelector("button, a, [tabindex]")).toBeNull();
    expect(background.getAttribute("data-status")).toBe("running");
  });
  it("keeps the CSS fallback and skips loading in data-saving mode", async () => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true },
    });
    await render();
    expect(
      container
        .querySelector(".hero-tidal-background")
        ?.getAttribute("data-status"),
    ).toBe("fallback");
    expect(idle).toBeUndefined();
    expect(adapter.mount).not.toHaveBeenCalled();
    expect(container.querySelector("button")).toBeNull();
  });
  it("degrades gracefully when the renderer cannot initialize", async () => {
    adapter.mount.mockImplementationOnce(() => {
      throw new Error("No canvas context");
    });
    await render();
    await enter();
    await load();
    expect(
      container
        .querySelector(".hero-tidal-background")
        ?.getAttribute("data-status"),
    ).toBe("fallback");
    expect(container.querySelector("button")).toBeNull();
  });
  it("does not offer a misleading play button when reduced motion requests a still image", async () => {
    adapter.mount.mockImplementationOnce(
      (_canvas, report: (status: HeroBackgroundStatus) => void) => {
        report("still");
        return { destroy: adapter.destroy };
      },
    );
    await render();
    await enter();
    await load();
    expect(
      container
        .querySelector(".hero-tidal-background")
        ?.getAttribute("data-ready"),
    ).toBe("true");
    expect(container.querySelector("button")).toBeNull();
  });
  it("cancels pending idle work when the component is removed", async () => {
    await render();
    await enter();
    await act(async () => root.render(null));
    expect(cancelIdle).toHaveBeenCalledWith(17);
    await act(async () => idle?.({ didTimeout: true, timeRemaining: () => 0 }));
    expect(adapter.mount).not.toHaveBeenCalled();
  });
  it("destroys the running controller on unmount", async () => {
    await render();
    await enter();
    await load();
    await act(async () => root.render(null));
    expect(adapter.destroy).toHaveBeenCalledTimes(1);
  });
});
