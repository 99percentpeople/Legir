import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResponsiveToolbar } from "@/components/toolbar/ResponsiveToolbar";
import { ToolOptionPopover } from "@/components/toolbar/ToolOptions";
import { appEventBus } from "@/lib/eventBus";
import type { ResponsiveToolbarItem } from "@/components/toolbar/types";

let host: HTMLDivElement;
let root: Root;
const widths: Record<string, number> = {
  page: 60,
  color: 44,
  thickness: 100,
  opacity: 60,
  exit: 44,
};
const items: ResponsiveToolbarItem[] = [
  { id: "page", pinned: true, label: "Page", content: <button>Page</button> },
  { id: "color", label: "Color", content: <button>Color</button> },
  {
    id: "thickness",
    label: "Thickness",
    content: (
      <ToolOptionPopover label="Thickness" trigger="2 px">
        <input aria-label="Width" defaultValue="2" />
      </ToolOptionPopover>
    ),
  },
  { id: "opacity", label: "Opacity", content: <button>100%</button> },
  { id: "exit", pinned: true, label: "Exit", content: <button>X</button> },
];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const width = this.hasAttribute("data-toolbar-more")
        ? 44
        : (widths[this.dataset.toolbarItem ?? ""] ?? 0);
      return {
        x: 0,
        y: 0,
        width,
        height: 32,
        left: 0,
        right: width,
        top: 0,
        bottom: 32,
        toJSON() {},
      };
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  appEventBus.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const render = async (width: number) =>
  act(async () =>
    root.render(<ResponsiveToolbar items={items} availableWidth={width} />),
  );
const clickMore = async () =>
  act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        'button[aria-label="toolbar.more_options"]',
      )!
      .click(),
  );
const openWidth = async () =>
  act(async () =>
    document
      .querySelector<HTMLButtonElement>(
        '[data-toolbar-overflow] button[aria-label="Thickness"]',
      )!
      .click(),
  );

describe("responsive toolbar", () => {
  it("hides only trailing options, keeps measurement copies inert and reuses options in More", async () => {
    await render(220);
    expect(
      host
        .querySelector('[data-toolbar-item="thickness"]')
        ?.hasAttribute("inert"),
    ).toBe(true);
    expect(
      host
        .querySelector('[data-toolbar-item="opacity"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    for (const id of ["page", "color", "exit"])
      expect(
        host
          .querySelector(`[data-toolbar-item="${id}"]`)
          ?.hasAttribute("inert"),
      ).toBe(false);
    await clickMore();
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>("[data-overflow-item]"),
      ).map((el) => el.dataset.overflowItem),
    ).toEqual(["thickness", "opacity"]);
    await openWidth();
    expect(document.querySelector('input[aria-label="Width"]')).not.toBeNull();
    await act(async () => appEventBus.emit("workspace:pointerDown", {}));
    expect(document.querySelector("[data-toolbar-overflow]")).toBeNull();
    expect(document.querySelector('input[aria-label="Width"]')).toBeNull();
  });

  it("restores options on growth and closes nested transient controls", async () => {
    await render(220);
    await clickMore();
    await openWidth();
    await render(600);
    expect(host.querySelectorAll("[data-toolbar-item][inert]")).toHaveLength(0);
    expect(
      host.querySelector("[data-toolbar-more]")?.hasAttribute("inert"),
    ).toBe(true);
    expect(document.querySelector("[data-toolbar-overflow]")).toBeNull();
    expect(document.querySelector('input[aria-label="Width"]')).toBeNull();
    await render(220);
    expect(host.querySelectorAll("[data-toolbar-item][inert]")).toHaveLength(2);
    expect(document.querySelector("[data-toolbar-overflow]")).toBeNull();
  });
});
