import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { EditorTabActiveContext } from "@/app/editorTabs/context";

let host: HTMLDivElement;
let root: Root;
const selected = vi.fn();
const changed = vi.fn();
const stopPointer = (event: React.PointerEvent) => event.stopPropagation();

function Reader({ active = true }: { active?: boolean }) {
  return (
    <EditorTabActiveContext.Provider value={active}>
      <div data-reader onPointerDown={stopPointer}>
        <ContextMenu modal={false} onOpenChange={changed}>
          <ContextMenuTrigger asChild>
            <div data-page>PDF page</div>
          </ContextMenuTrigger>
          <ContextMenuContent onPointerDown={stopPointer}>
            <ContextMenuItem disabled>
              Disabled{" "}
              <svg data-menu-icon>
                <path />
              </svg>
            </ContextMenuItem>
            <ContextMenuItem onSelect={selected}>Paste</ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>More</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onSelect={selected}>
                  Submenu action
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuContent>
        </ContextMenu>
        <div data-other>Another page</div>
      </div>
      <button data-toolbar onPointerDown={stopPointer}>
        Toolbar
      </button>
    </EditorTabActiveContext.Provider>
  );
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Reader />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const menu = () =>
  document.querySelector(
    '[data-slot="context-menu-content"][data-state="open"]',
  );
const open = async () => {
  await act(async () => {
    host.querySelector("[data-page]")!.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 100,
        clientY: 100,
      }),
    );
  });
  // Radix installs its document listener after the opening event.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(menu()).not.toBeNull();
};
const pointerDown = async (target: Element) => {
  const event = new MouseEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  await act(async () => {
    target.dispatchEvent(event);
  });
};

it.each(["[data-page]", "[data-other]", "[data-toolbar]"])(
  "dismisses on the first outside pointerdown even when %s stops propagation",
  async (selector) => {
    await open();
    await pointerDown(host.querySelector(selector)!);
    expect(menu()).toBeNull();
    expect(changed).toHaveBeenLastCalledWith(false);
    expect(selected).not.toHaveBeenCalled();
    await open();
  },
);

it("dismisses when the reader scrolls, including non-bubbling native scroll events", async () => {
  await open();
  await act(async () => {
    host.querySelector("[data-reader]")!.dispatchEvent(new Event("scroll"));
  });
  expect(menu()).toBeNull();
  expect(changed).toHaveBeenLastCalledWith(false);
});

it("keeps menu contents interactive and permits scrolling inside the menu", async () => {
  await open();
  await pointerDown(document.querySelector("[data-menu-icon] path")!);
  await act(async () => menu()!.dispatchEvent(new Event("scroll")));
  expect(menu()).not.toBeNull();
  const item = [
    ...menu()!.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((node) => node.textContent === "Paste")!;
  await pointerDown(item);
  expect(menu()).not.toBeNull();
  await act(async () => item.click());
  expect(selected).toHaveBeenCalledOnce();
  expect(menu()).toBeNull();
});

it("keeps a submenu open for its own pointer and scroll events, then closes the whole menu on page scroll", async () => {
  await open();
  const trigger = document.querySelector<HTMLElement>(
    '[data-slot="context-menu-sub-trigger"]',
  )!;
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  const submenu = document.querySelector(
    '[data-slot="context-menu-sub-content"]',
  )!;
  expect(submenu).not.toBeNull();
  await pointerDown(submenu);
  await act(async () => submenu.dispatchEvent(new Event("scroll")));
  expect(menu()).not.toBeNull();
  await act(async () =>
    host.querySelector("[data-reader]")!.dispatchEvent(new Event("scroll")),
  );
  expect(menu()).toBeNull();
  expect(
    document.querySelector('[data-slot="context-menu-sub-content"]'),
  ).toBeNull();
});

it("does not dismiss other popups after its tab becomes inactive", async () => {
  await open();
  await act(async () => root.render(<Reader active={false} />));
  expect(menu()).toBeNull();
  const escape = vi.fn();
  document.addEventListener("keydown", escape);
  try {
    await pointerDown(host.querySelector("[data-other]")!);
    await act(async () =>
      host.querySelector("[data-reader]")!.dispatchEvent(new Event("scroll")),
    );
    expect(escape).not.toHaveBeenCalled();
  } finally {
    document.removeEventListener("keydown", escape);
  }
});
