import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { EditorTabActiveContext } from "@/app/editorTabs/context";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";

afterEach(() => vi.unstubAllGlobals());

const overlays = {
  popover: (
    <Popover open>
      <PopoverTrigger>Open</PopoverTrigger>
      <PopoverContent>Retained popup</PopoverContent>
    </Popover>
  ),
  dialog: (
    <Dialog open>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Retained popup</DialogTitle>
      </DialogContent>
    </Dialog>
  ),
  menu: (
    <DropdownMenu open>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Retained popup</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  // Workspace annotation tooltips also use raw Radix portals beneath our root.
  tooltip: (
    <Tooltip open>
      <TooltipTrigger>Open</TooltipTrigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content>Retained popup</TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </Tooltip>
  ),
};

describe("keepalive body portals", () => {
  it.each(Object.entries(overlays))(
    "removes %s content and document locks when its owning tab hides",
    async (_name, overlay) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      const render = async (active: boolean) =>
        act(async () => {
          root.render(
            <EditorTabActiveContext.Provider value={active}>
              {overlay}
            </EditorTabActiveContext.Provider>,
          );
        });
      try {
        await render(true);
        expect(document.body.textContent).toContain("Retained popup");
        await render(false);
        expect(document.body.textContent).not.toContain("Retained popup");
        expect(document.body.style.pointerEvents).not.toBe("none");
        expect(host.textContent).toContain("Open");
        await render(true);
        expect(document.body.textContent).toContain("Retained popup");
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );
});
