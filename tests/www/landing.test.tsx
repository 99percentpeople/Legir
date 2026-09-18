import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePreview } from "../../www/src/components/WorkspacePreview";
import { getLandingCopy, landingCopy } from "../../www/src/content";
import { en } from "../../www/src/content/en";
import { PREVIEW_MODES } from "../../www/src/content/types";
import { resolveAppUrl } from "../../www/src/lib/app-url";
import {
  demoCopy,
  getDemoCopy,
} from "../../www/src/components/workspace-demo/copy";
import {
  demoReducer,
  getTranslationId,
  initialDemoState,
  INTRO,
  PARAGRAPH,
  QUOTE,
} from "../../www/src/components/workspace-demo/types";
import {
  DEMO_PAGES,
  DEMO_CANVAS_PADDING,
  PAPER_WIDTH,
  PAPER_HEIGHT,
  demoFitZoom,
  demoPageGroups,
} from "../../www/src/components/workspace-demo/geometry";
import {
  calculateWorkspaceFitScreenScale,
  calculateWorkspaceFitWidthScale,
} from "@/components/workspace/lib/calculateWorkspaceFitScale";
import { workspaceScaleToPdfViewerScale } from "@/lib/pdfScale";
import { FIT_WIDTH_PADDING_X } from "@/constants";

// Importing the editing runtime from a public demo would initialize PDF workers.
vi.mock("@/store/useEditorStore", () => {
  throw new Error("The www demo must not import the application editor store");
});

// Third-party decorative logo modules use extensionless ESM imports under Node.
// Keep the actual panel, composer, selectors and messages in these integration tests.
vi.mock("@/components/ProviderLogo", () => ({
  ProviderLogo: () => <svg data-provider-logo />,
}));

function leafPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") {
    expect(value.trim().length).toBeGreaterThan(0);
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => leafPaths(child, `${prefix}.${key}`),
  );
}
describe("landing page copy", () => {
  it.each(Object.entries(landingCopy))(
    "has complete %s copy",
    (language, copy) => {
      expect(leafPaths(copy)).toEqual(leafPaths(en));
      expect(Object.keys(copy.preview.modes)).toEqual(PREVIEW_MODES);
      expect(leafPaths(getDemoCopy(language))).toEqual(leafPaths(demoCopy.en));
    },
  );
  it.each(["system", "unknown", "__proto__", "constructor"])(
    "falls back for %s",
    (language) => {
      expect(getLandingCopy(language)).toBe(en);
      expect(getDemoCopy(language)).toBe(demoCopy.en);
    },
  );
});
describe("landing app URL", () => {
  it("respects the deployment override", () =>
    expect(
      resolveAppUrl(
        " https://reader.example.com/workspace ",
        new URL("https://www.example.com"),
      ),
    ).toBe("https://reader.example.com/workspace"));
  it.each([
    ["http://localhost:5174", "http://localhost:5173"],
    ["http://127.0.0.1:5174", "http://localhost:5173"],
    ["http://[::1]:5174", "http://localhost:5173"],
    ["http://0.0.0.0:5174", "http://localhost:5173"],
    ["https://www.example.com", "https://app.example.com"],
    ["https://example.com", "https://app.example.com"],
    ["https://app.example.com", "https://app.example.com"],
    ["http://www.example.com:8080", "http://app.example.com:8080"],
  ])("routes %s to %s", (source, target) =>
    expect(resolveAppUrl("", new URL(source))).toBe(target),
  );
  it("falls back outside a browser", () => expect(resolveAppUrl()).toBe("/"));
});
describe("demo document state and source geometry", () => {
  it("separates scroll feedback from explicit navigation, including same-page navigation", () => {
    const scrolled = demoReducer(initialDemoState, {
      type: "visible-page",
      page: 2,
    });
    expect(scrolled.page).toBe(2);
    expect(scrolled.navigationToken).toBe(initialDemoState.navigationToken);
    expect(demoReducer(scrolled, { type: "visible-page", page: 2 })).toBe(
      scrolled,
    );
    const navigated = demoReducer(scrolled, { type: "page", page: 2 });
    expect(navigated.navigationToken).toBe(scrolled.navigationToken + 1);
  });
  it("keeps annotation text and replies in undo history", () => {
    const edited = demoReducer(initialDemoState, {
      type: "annotation-text",
      text: "A revised note",
    });
    const replied = demoReducer(edited, {
      type: "annotation-replies",
      replies: [
        {
          id: "reply",
          parentAnnotationId: "demo-highlight",
          text: "A response",
        },
      ],
    });
    const undone = demoReducer(replied, { type: "undo" });
    expect(undone.annotationText).toBe("A revised note");
    expect(undone.replies).toEqual([]);
    expect(demoReducer(undone, { type: "redo" }).replies).toEqual(
      replied.replies,
    );
  });
  it("clamps pages and physical zoom", () => {
    expect(demoReducer(initialDemoState, { type: "page", page: 99 }).page).toBe(
      3,
    );
    expect(demoReducer(initialDemoState, { type: "page", page: -1 }).page).toBe(
      1,
    );
    expect(
      demoReducer(initialDemoState, { type: "zoom", delta: 900 }).zoom,
    ).toBe(200);
    expect(
      demoReducer(initialDemoState, { type: "zoom", delta: -900 }).zoom,
    ).toBe(25);
  });
  it("uses the app's PDF-point to CSS-pixel conversion and fit calculation", () => {
    expect(PAPER_WIDTH).toBeCloseTo((595 * 96) / 72);
    expect(PAPER_HEIGHT).toBeCloseTo((842 * 96) / 72);
    const viewport = { width: 880, height: 720 };
    const scale = calculateWorkspaceFitScreenScale({
      pages: DEMO_PAGES,
      pageLayout: "single",
      pageFlow: "vertical",
      viewport,
    });
    expect(demoFitZoom({ ...initialDemoState, fit: "screen" }, viewport)).toBe(
      workspaceScaleToPdfViewerScale(scale) * 100,
    );
    const widthScale = calculateWorkspaceFitWidthScale({
      pages: DEMO_PAGES,
      pageLayout: "single",
      pageFlow: "vertical",
      viewport: {
        ...viewport,
        width: viewport.width + FIT_WIDTH_PADDING_X - DEMO_CANVAS_PADDING * 2,
      },
    });
    expect(demoFitZoom(initialDemoState, viewport)).toBe(
      workspaceScaleToPdfViewerScale(widthScale) * 100,
    );
    expect(demoFitZoom(initialDemoState, viewport)).toBeGreaterThan(90);
    expect(demoPageGroups("double_even")).toEqual([[1], [2, 3]]);
    expect(demoPageGroups("double_odd")).toEqual([[1, 2], [3]]);
  });
  it("defaults every preset to fit-width instead of shrinking the whole sheet", () => {
    expect(initialDemoState.fit).toBe("width");
    for (const mode of PREVIEW_MODES) {
      const state = demoReducer(initialDemoState, { type: "mode", mode });
      expect(state.fit).toBe("width");
    }
  });
  it.each([286, 358, 542, 862])(
    "fills the canvas with compact insets at %ipx",
    (width) => {
      const sheetWidth =
        (demoFitZoom(initialDemoState, { width, height: 630 }) / 100) *
        PAPER_WIDTH;
      expect(sheetWidth / width).toBeGreaterThan(0.88);
      expect(sheetWidth).toBeLessThanOrEqual(
        width - DEMO_CANVAS_PADDING * 2 + 3,
      );
    },
  );
  it("keeps translation independent of the AI sidebar", () => {
    const ai = demoReducer(initialDemoState, { type: "panel", panel: "ai" });
    const translated = demoReducer(ai, {
      type: "translate",
      open: true,
      auto: true,
    });
    expect(translated.panel).toBe("ai");
    expect(translated.translationOpen).toBe(true);
    expect(translated.translationToken).toBe(1);
    expect(
      demoReducer(translated, { type: "translate", open: false }).panel,
    ).toBe("ai");
  });
  it("undoes and redoes edits rather than toggling unrelated state", () => {
    let state = demoReducer(initialDemoState, {
      type: "field",
      field: "name",
      value: "Reader",
    });
    state = demoReducer(state, { type: "highlight" });
    state = demoReducer(state, { type: "undo" });
    expect(state.highlighted).toBe(false);
    expect(state.fields.name).toBe("Reader");
    state = demoReducer(state, { type: "undo" });
    expect(state.fields.name).toBe("Alex Chen");
    state = demoReducer(state, { type: "redo" });
    expect(state.fields.name).toBe("Reader");
    expect(demoReducer(state, { type: "reset" })).toEqual(initialDemoState);
  });
  it("preserves fields across presets and rejects incorrect field types", () => {
    let state = demoReducer(initialDemoState, {
      type: "field",
      field: "note",
      value: "Keep this",
    });
    for (const mode of PREVIEW_MODES)
      state = demoReducer(state, { type: "mode", mode });
    expect(state.fields.note).toBe("Keep this");
    expect(
      demoReducer(state, { type: "field", field: "reviewed", value: "yes" }),
    ).toBe(state);
    expect(
      demoReducer(state, { type: "field", field: "email", value: false }),
    ).toBe(state);
  });
  it.each([
    [QUOTE, "quote"],
    [INTRO, "intro"],
    [PARAGRAPH, "paragraph"],
  ])("recognizes %s", (text, id) => expect(getTranslationId(text)).toBe(id));
  it("does not substitute a different excerpt for unsupported text", () => {
    expect(getTranslationId(QUOTE.replace(" It", "\nIt"))).toBe("quote");
    expect(getTranslationId("Reading")).toBeNull();
  });
});

describe("source-backed interactive workspace", () => {
  let root: Root;
  let container: HTMLDivElement;
  const render = async (language = "en") =>
    act(async () =>
      root.render(
        <WorkspacePreview
          copy={getLandingCopy(language).preview}
          language={language}
        />,
      ),
    );
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal("fetch", vi.fn());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await render();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.getSelection()?.removeAllRanges();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const q = (selector: string) =>
    container.querySelector<HTMLElement>(selector);
  const click = async (element: Element | null) => {
    expect(element).not.toBeNull();
    await act(async () => (element as HTMLElement).click());
  };
  const tabs = () =>
    Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '.preview-tabs [role="tab"]',
      ),
    );
  const mode = async (index: number) => click(tabs()[index]);
  async function change(
    input: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ) {
    const prototype =
      input.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
        input,
        value,
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  it("renders HTML pages and retains separate accessible preset and sidebar tabs", () => {
    expect(q("canvas,iframe,.workspace-screenshot")).toBeNull();
    expect(container.querySelectorAll("[data-demo-page]")).toHaveLength(3);
    expect(tabs()).toHaveLength(5);
    expect(tabs().filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
    const panel = q(".workspace-frame")!;
    for (const tab of tabs())
      expect(document.getElementById(tab.getAttribute("aria-controls")!)).toBe(
        panel,
      );
    expect(q('.demo-sidebar [data-slot="tabs-list"]')).not.toBeNull();
    expect(q('[title="properties.document.title"]')).not.toBeNull();
    expect(q('[title="right_panel.tabs.page_translate"]')).not.toBeNull();
  });
  it("handles preset keyboard wrapping without changing sidebar selection", async () => {
    for (const [from, key, to] of [
      [0, "ArrowLeft", 4],
      [4, "ArrowRight", 0],
      [0, "End", 4],
      [4, "Home", 0],
    ] as const) {
      await act(async () =>
        tabs()[from].dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        ),
      );
      expect(document.activeElement).toBe(tabs()[to]);
      expect(tabs()[to].getAttribute("aria-selected")).toBe("true");
    }
  });
  it("keeps editable form values in memory without changing storage", async () => {
    const write = vi.spyOn(Storage.prototype, "setItem");
    await mode(2);
    await change(q("#demo-name") as HTMLInputElement, "Reader");
    await change(q("#demo-note") as HTMLTextAreaElement, "A local note");
    await click(q(".demo-reviewed input"));
    await mode(3);
    await mode(0);
    await mode(2);
    expect((q("#demo-name") as HTMLInputElement).value).toBe("Reader");
    expect((q("#demo-note") as HTMLTextAreaElement).value).toBe("A local note");
    expect((q(".demo-reviewed input") as HTMLInputElement).checked).toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("deletes annotations and uses real undo and redo commands", async () => {
    await mode(1);
    expect(q("mark")?.dataset.active).toBe("true");
    const trigger = q(
      '#annotation-card-demo-highlight [data-slot="dropdown-menu-trigger"]',
    )!;
    await act(async () =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(
      (element) => element.textContent?.includes("common.actions.delete"),
    );
    await click(item ?? null);
    expect(q("mark")?.dataset.active).toBe("false");
    await click(q('[aria-label="toolbar.undo"]'));
    expect(q("mark")?.dataset.active).toBe("true");
    await click(q('[aria-label="toolbar.redo"]'));
    expect(q("mark")?.dataset.active).toBe("false");
  });
  it("uses the same document content in inert live thumbnails without duplicate inputs", async () => {
    expect(q(".demo-mini-paper")?.textContent).toContain(PARAGRAPH);
    expect(
      q(
        ".demo-mini-paper input,.demo-mini-paper button,.demo-mini-paper textarea,.demo-mini-paper [id]",
      ),
    ).toBeNull();
    await change(q("#demo-name") as HTMLInputElement, "Live thumbnail value");
    expect(q(".demo-thumbnails")?.textContent).toContain(
      "Live thumbnail value",
    );
    expect(container.querySelectorAll("#demo-name")).toHaveLength(1);
    expect(q("#demo-reviewed")).not.toBeNull();
  });
  it("mounts the actual searchable outline and field tree", async () => {
    const activateTab = async (title: string) =>
      act(async () =>
        q(`[title="${title}"]`)!.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, button: 0 }),
        ),
      );
    await activateTab("sidebar.outline");
    const search = q(
      '[placeholder="sidebar.search_outline"]',
    ) as HTMLInputElement;
    expect(search).not.toBeNull();
    await change(search, "Keep the thought");
    const panel = search.closest('[role="tabpanel"]')!;
    expect(panel.textContent).toContain("Keep the thought going.");
    expect(panel.textContent).not.toContain("Make room for a good idea.");
    await activateTab("sidebar.fields");
    const filter = q(
      '[placeholder="sidebar.filter_fields"]',
    ) as HTMLInputElement;
    await change(filter, demoCopy.en.email);
    expect(filter.closest('[role="tabpanel"]')?.textContent).toContain(
      demoCopy.en.email,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("adds replies through the actual annotation card without a provider request", async () => {
    await mode(1);
    await click(q("#annotation-card-demo-highlight"));
    const reply = q('[placeholder="sidebar.add_reply"]') as HTMLTextAreaElement;
    expect(reply).not.toBeNull();
    await change(reply, "A locally saved reply");
    await click(
      q('#annotation-card-demo-highlight [title="common.actions.send"]'),
    );
    expect(q("#annotation-card-demo-highlight")?.textContent).toContain(
      "A locally saved reply",
    );
    await mode(0);
    await mode(1);
    await click(q("#annotation-card-demo-highlight"));
    expect(q("#annotation-card-demo-highlight")?.textContent).toContain(
      "A locally saved reply",
    );
    await click(q('[aria-label="toolbar.undo"]'));
    expect(q("#annotation-card-demo-highlight")?.textContent).not.toContain(
      "A locally saved reply",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("mounts the real panel layout, message actions, model select and composer", async () => {
    await mode(3);
    const panel = q(".demo-runtime-panel")!;
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('[data-slot="panel-body"]')).not.toBeNull();
    expect(
      panel.querySelector('textarea[placeholder="ai_chat.input_placeholder"]'),
    ).not.toBeNull();
    expect(
      panel.querySelector('[aria-label="ai_chat.new_chat"]'),
    ).not.toBeNull();
    expect(
      panel.querySelector('[aria-label="common.actions.send"]'),
    ).not.toBeNull();
    expect(panel.textContent).toContain("DeepSeek · Demo");
    expect(panel.textContent).toContain(demoCopy.en.aiNotice);
    expect(panel.textContent).not.toContain("empty_no_model");
  });
  it("sends an authored local response and preserves the completed answer on view changes", async () => {
    await mode(3);
    const input = q(".demo-runtime-panel textarea") as HTMLTextAreaElement;
    await change(input, "An unrelated question");
    await click(q('[aria-label="common.actions.send"]'));
    expect(q(".demo-runtime-panel")?.textContent).toContain(
      demoCopy.en.answers.fallback,
    );
    await mode(0);
    await mode(3);
    expect(q(".demo-runtime-panel")?.textContent).toContain(
      demoCopy.en.answers.fallback,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  const readTokenStats = () => {
    const data = q(".demo-runtime-panel")!.dataset;
    return {
      input: Number(data.inputTokens),
      output: Number(data.outputTokens),
      total: Number(data.totalTokens),
      context: Number(data.contextTokens),
    };
  };
  it("shows nonzero seeded token stats in the actual footer and accumulates only sent turns", async () => {
    await mode(3);
    const seeded = readTokenStats();
    expect(seeded.input).toBeGreaterThan(1000);
    expect(seeded.output).toBeGreaterThan(0);
    expect(seeded.total).toBe(seeded.input + seeded.output);
    expect(q(".demo-runtime-panel")?.textContent).toContain(
      new Intl.NumberFormat("en").format(seeded.total),
    );
    await change(
      q(".demo-runtime-panel textarea") as HTMLTextAreaElement,
      "A local question",
    );
    expect(readTokenStats()).toEqual(seeded);
    await click(q('[aria-label="common.actions.send"]'));
    const next = readTokenStats();
    expect(next.total).toBeGreaterThan(seeded.total);
    expect(next.context).toBeLessThan(next.total);
    expect(next.total).toBe(next.input + next.output);
    await mode(0);
    await mode(3);
    expect(readTokenStats()).toEqual(next);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("updates output stats during playback and freezes them when stopped", async () => {
    await mode(3);
    vi.useFakeTimers();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const seeded = readTokenStats();
    await change(
      q(".demo-runtime-panel textarea") as HTMLTextAreaElement,
      "Another question",
    );
    await click(q('[aria-label="common.actions.send"]'));
    const started = readTokenStats();
    expect(started.input).toBeGreaterThan(seeded.input);
    expect(started.output).toBe(seeded.output);
    await act(async () => vi.advanceTimersByTime(112));
    const partial = readTokenStats();
    expect(partial.input).toBe(started.input);
    expect(partial.output).toBeGreaterThan(started.output);
    expect(partial.total).toBe(partial.input + partial.output);
    await click(q('[aria-label="common.actions.stop"]'));
    await act(async () => vi.advanceTimersByTime(5000));
    expect(readTokenStats()).toEqual(partial);
    await mode(0);
    await mode(3);
    expect(readTokenStats()).toEqual(partial);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("replaces regenerated branches without double-counting their usage", async () => {
    await mode(3);
    const seeded = readTokenStats();
    await click(q('[aria-label="common.actions.regenerate"]'));
    expect(readTokenStats()).toEqual(seeded);
    await change(
      q(".demo-runtime-panel textarea") as HTMLTextAreaElement,
      "A second turn",
    );
    await click(q('[aria-label="common.actions.send"]'));
    expect(readTokenStats().total).toBeGreaterThan(seeded.total);
    // Regenerating the earlier answer replaces the local follow-up branch.
    await click(q('[aria-label="common.actions.regenerate"]'));
    expect(readTokenStats()).toEqual(seeded);
    expect(q(".demo-runtime-panel")?.textContent).not.toContain(
      "A second turn",
    );
  });
  it("clears counters for a new conversation and restores the seed on reset", async () => {
    await mode(3);
    const seeded = readTokenStats();
    await click(q('[aria-label="ai_chat.new_chat"]'));
    expect(readTokenStats()).toEqual({
      input: 0,
      output: 0,
      total: 0,
      context: 0,
    });
    await change(
      q(".demo-runtime-panel textarea") as HTMLTextAreaElement,
      "Fresh conversation",
    );
    await click(q('[aria-label="common.actions.send"]'));
    expect(readTokenStats().total).toBeGreaterThan(0);
    await click(q(".preview-reset"));
    await mode(3);
    expect(readTokenStats()).toEqual(seeded);
  });
  it("starts an empty local conversation from the real new-chat button", async () => {
    await mode(3);
    await click(q('[aria-label="ai_chat.new_chat"]'));
    expect(q(".demo-runtime-panel")?.textContent).toContain(
      "ai_chat.empty_title",
    );
    expect(q(".demo-runtime-panel")?.textContent).not.toContain(
      "ai_chat.empty_no_model",
    );
  });
  it("contains the fixed translation card inside the demo without replacing AI", async () => {
    await mode(3);
    await click(q('[title="translate.title"]'));
    const window = document.querySelector(".demo-translation-window");
    expect(window).not.toBeNull();
    expect(q(".demo-runtime-panel")?.hidden).toBe(false);
    expect(window?.querySelector('[data-slot="tabs"]')).not.toBeNull();
    expect(window?.textContent).toContain(demoCopy["zh-CN"].translations.quote);
    const sourceTab = window!.querySelectorAll('[role="tab"]')[0];
    await act(async () =>
      sourceTab.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      ),
    );
    expect(sourceTab.getAttribute("data-state")).toBe("active");
    expect(window?.querySelector("textarea")).not.toBeNull();
    expect(window?.parentElement).toBe(q(".demo-editor-body"));
    expect(
      window?.querySelector(
        '[class*="cursor-ns-resize"], [class*="cursor-ew-resize"], [class*="cursor-nwse-resize"], [class*="cursor-nesw-resize"]',
      ),
    ).toBeNull();
    expect(window?.querySelector('[class*="cursor-move"]')).toBeNull();
    await click(window!.querySelector('[title="common.actions.close"]'));
    expect(q(".demo-translation-window")).toBeNull();
    expect(q(".demo-runtime-panel")?.hidden).toBe(false);
  });
  it("shows a fixed sample with inert app-style handles and local selection actions", async () => {
    await click(q(".demo-excerpt-trigger"));
    const selection = q(".demo-fixed-selection")!;
    const popup = q(".demo-selection-actions")!;
    expect(selection.dataset.selected).toBe("true");
    expect(popup.querySelectorAll("button")).toHaveLength(5);
    expect(q(".demo-editor-body")?.contains(popup)).toBe(true);
    expect(
      selection.querySelectorAll(".app-text-selection-handle__dot"),
    ).toHaveLength(2);
    expect(selection.querySelector("[data-app-selection-handle]")).toBeNull();
    expect(
      selection
        .querySelector(".demo-selection-handles")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(window.getSelection()?.rangeCount).toBe(0);
    await click(popup.querySelector('[title="toolbar.translate"]'));
    expect(q(".demo-translation-window")?.textContent).toContain(
      demoCopy["zh-CN"].translations.quote,
    );
    expect(q(".demo-fixed-selection")?.dataset.selected).toBe("true");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("stages the same selection on the translation preset without native selection", async () => {
    await mode(4);
    expect(q(".demo-fixed-selection mark")?.textContent).toBe(QUOTE);
    expect(q(".demo-fixed-selection")?.dataset.selected).toBe("true");
    expect(q(".demo-selection-actions")).not.toBeNull();
    expect(window.getSelection()?.rangeCount).toBe(0);
    await mode(0);
    expect(q(".demo-translation-window")).toBeNull();
    expect(q(".demo-selection-actions")).toBeNull();
  });
  it("resets local form and conversation state", async () => {
    await mode(2);
    await change(q("#demo-name") as HTMLInputElement, "Changed");
    await click(q(".preview-reset"));
    expect((q("#demo-name") as HTMLInputElement).value).toBe("Alex Chen");
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
  });
  it("clears the old localized conversation when the language changes", async () => {
    await mode(3);
    await render("zh-CN");
    expect(tabs()[3].textContent).toBe("AI 助手");
    expect(q(".demo-runtime-panel")?.textContent).toContain(
      demoCopy["zh-CN"].aiNotice,
    );
    expect(q(".demo-runtime-panel")?.textContent).not.toContain(
      demoCopy.en.aiNotice,
    );
  });
});
