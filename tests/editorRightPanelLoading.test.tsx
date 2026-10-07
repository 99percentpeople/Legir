import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorRightPanel } from "@/pages/EditorPage/EditorRightPanel";
import { useEditorView } from "@/store/useEditorView";

const suspended = vi.hoisted(() => ({
  forever: new Promise<never>(() => {}),
}));

vi.mock("@/pages/EditorPage/EditorAiRightPanel", () => ({
  default: () => {
    throw suspended.forever;
  },
}));

vi.mock("@/pages/EditorPage/EditorPageTranslateRightPanel", () => ({
  default: () => {
    throw suspended.forever;
  },
}));

describe("EditorRightPanel lazy loading fallback", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useEditorView.setState(
      {
        ...useEditorView.getInitialState(),
        mode: "form",
        isRightPanelOpen: true,
        isPanelFloating: false,
        rightPanelWidth: 356,
      },
      true,
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useEditorView.setState(useEditorView.getInitialState(), true);
    vi.unstubAllGlobals();
  });

  const renderPanel = async (tab: "ai_chat" | "page_translate") => {
    useEditorView.setState({ rightPanelTab: tab });
    await act(async () => {
      root.render(
        <EditorRightPanel
          aiScopeId="tab-a"
          onAiSearchHighlightsChange={() => {}}
        />,
      );
      await vi.dynamicImportSettled();
    });
  };

  it.each(["ai_chat", "page_translate"] as const)(
    "keeps the shell skeleton visible while the %s branch is still loading",
    async (tab) => {
      await renderPanel(tab);

      const fallback = container.querySelector<HTMLElement>(
        '[aria-hidden="true"]',
      );
      expect(fallback).not.toBeNull();
      expect(fallback?.style.width).toBe("356px");
      expect(
        container.querySelectorAll('[data-slot="skeleton"]').length,
      ).toBeGreaterThan(0);
    },
  );

  it("does not reveal a loading skeleton after the panel is closed", async () => {
    await renderPanel("ai_chat");
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();

    await act(async () => useEditorView.getState().closeRightPanel());

    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});
