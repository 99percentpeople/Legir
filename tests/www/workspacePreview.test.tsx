import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePreview } from "../../www/src/components/WorkspacePreview";
import { getLandingCopy } from "../../www/src/content";
import { PREVIEW_MODES } from "../../www/src/content/types";

const demo = vi.hoisted(() => ({
  load: vi.fn(),
  mount: vi.fn(),
  unmount: vi.fn(),
}));
vi.mock("../../www/src/components/workspace-demo/WorkspaceDemo", () => {
  demo.load();
  return {
    WorkspaceDemo() {
      useEffect(() => {
        demo.mount();
        return () => demo.unmount();
      }, []);
      return <div data-live-preview />;
    },
  };
});

describe("responsive workspace preview", () => {
  let container: HTMLDivElement;
  let root: Root;
  let mobile: boolean;
  const listeners = new Set<() => void>();
  const copy = getLandingCopy("zh-CN").preview;

  beforeEach(async () => {
    mobile = true;
    listeners.clear();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        get matches() {
          return query.startsWith("(max-width: 767px)") && mobile;
        },
        addEventListener: (_event: string, callback: () => void) => {
          if (query.startsWith("(max-width: 767px)")) listeners.add(callback);
        },
        removeEventListener: (_event: string, callback: () => void) =>
          listeners.delete(callback),
      })),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root.render(<WorkspacePreview copy={copy} language="zh-CN" />),
    );
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("switches six mobile images without importing or mounting the live demo", async () => {
    const tabs = container.querySelectorAll<HTMLButtonElement>(
      '.preview-tabs [role="tab"]',
    );
    expect(tabs).toHaveLength(6);
    for (const [index, mode] of PREVIEW_MODES.entries()) {
      await act(async () => tabs[index].click());
      const image = container.querySelector(".workspace-screenshot img");
      expect(image?.getAttribute("src")).toContain(`zh-CN-light-${mode}.webp`);
      expect(image?.getAttribute("alt")).toContain(copy.modes[mode]);
    }
    await act(async () => vi.dynamicImportSettled());
    expect(demo.load).not.toHaveBeenCalled();
    expect(demo.mount).not.toHaveBeenCalled();
    expect(container.querySelector(".preview-playback-controls")).toBeNull();
  });

  it("loads on desktop and unmounts the animation when returning to mobile", async () => {
    await act(async () => {
      mobile = false;
      listeners.forEach((listener) => listener());
    });
    await act(async () => vi.dynamicImportSettled());
    expect(container.querySelector("[data-live-preview]")).not.toBeNull();
    expect(
      container.querySelector(".preview-playback-controls"),
    ).not.toBeNull();
    expect(demo.mount).toHaveBeenCalledOnce();
    await act(async () => {
      mobile = true;
      listeners.forEach((listener) => listener());
    });
    expect(demo.unmount).toHaveBeenCalledOnce();
    expect(container.querySelector("[data-live-preview]")).toBeNull();
    expect(container.querySelector(".workspace-screenshot img")).not.toBeNull();
  });
});
