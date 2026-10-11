import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

afterEach(() => vi.unstubAllGlobals());

it("preserves child refs and restores focus without React 19 ref warnings", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const error = vi.spyOn(console, "error");
  const trigger = createRef<HTMLButtonElement>();
  const close = createRef<HTMLButtonElement>();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const dialog = () => document.querySelector('[role="dialog"]');
  try {
    await act(async () =>
      root.render(
        <Dialog>
          <DialogTrigger asChild>
            <Button ref={trigger}>Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Edit document</DialogTitle>
            <DialogDescription>Review document details.</DialogDescription>
            <input aria-label="Document title" />
            <DialogClose asChild>
              <Button ref={close}>Save and close</Button>
            </DialogClose>
          </DialogContent>
        </Dialog>,
      ),
    );
    expect(trigger.current).toBe(host.querySelector("button"));
    for (const dismissal of ["escape", "button"]) {
      trigger.current!.focus();
      await act(async () => trigger.current!.click());
      expect(dialog()).not.toBeNull();
      expect(dialog()!.contains(document.activeElement)).toBe(true);
      expect(close.current?.textContent).toBe("Save and close");
      await act(async () => {
        if (dismissal === "escape")
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
        else close.current!.click();
      });
      expect(dialog()).toBeNull();
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(trigger.current),
      );
      expect(document.body.style.pointerEvents).not.toBe("none");
    }
    expect(error).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
