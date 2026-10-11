import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/components/language-provider";
import { ImportPreview } from "@/components/page-editor/ImportPreview";
import type { ImportedDocument } from "@/components/page-editor/types";
import { page } from "./helpers/editorStore";

afterEach(() => vi.unstubAllGlobals());

it("keeps large import previews bounded and selects ranges across scrolled-out pages", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(304);
  const imported = {
    filename: "large.pdf",
    document: {
      fields: [],
      annotations: [],
      preservedSourceAnnotations: [],
      pages: Array.from({ length: 1000 }, (_, i) => ({
        ...page(i),
        blank: true,
      })),
    },
  } as unknown as ImportedDocument;
  function Preview() {
    const [range, setRange] = useState("");
    return (
      <LanguageProvider defaultLanguage="en">
        <ImportPreview
          imported={imported}
          range={range}
          onRangeChange={setRange}
        >
          <div />
        </ImportPreview>
      </LanguageProvider>
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Preview />));
    const viewport = host.querySelector<HTMLElement>(
      "[data-import-preview-grid]",
    )!;
    const button = (number: number) =>
      host.querySelector<HTMLButtonElement>(
        `button[aria-label="Page ${number}"]`,
      );
    const input = host.querySelector<HTMLInputElement>("input")!;
    const count = () => host.querySelectorAll("[data-import-page]").length;
    expect(count()).toBeLessThan(20);
    expect(button(301)).toBeNull();
    await act(async () => button(1)!.click());
    await act(async () => {
      viewport.scrollTop = 15212;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(count()).toBeLessThan(20);
    expect(button(1)).toBeNull();
    await act(async () =>
      button(301)!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, shiftKey: true }),
      ),
    );
    expect(input.value).toBe("1-301");
    await act(async () => {
      viewport.scrollTop = 50500;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(count()).toBeLessThan(20);
    expect(button(1000)).not.toBeNull();
    await act(async () => {
      viewport.scrollTop = 0;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(button(1)!.getAttribute("aria-pressed")).toBe("true");
    expect(input.value).toBe("1-301");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
