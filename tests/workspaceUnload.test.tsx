import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { usePlatformWindowSessionPersistence } from "@/app/usePlatformWindowSessionPersistence";

it("warns on browser unload while Home is selected and background documents are dirty", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const capture = vi.fn();
  function Probe({ dirty }: { dirty: boolean }) {
    usePlatformWindowSessionPersistence({
      enabled: true,
      isDesktop: false,
      hasActiveTab: false,
      hasDirtyTabs: dirty,
      persistCurrentTabState: capture,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Probe dirty />));
    const dirtyUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
    expect(capture).not.toHaveBeenCalled();
    await act(async () => root.render(<Probe dirty={false} />));
    const cleanUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
