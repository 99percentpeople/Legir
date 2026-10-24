import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PageEditor from "@/components/page-editor/PageEditor";
import { EditorViewContext } from "@/store/useEditorView";
import { LanguageProvider } from "@/components/language-provider";
import { createTestEditorStore, page } from "./helpers/editorStore";

// dnd-kit creates its shared observer when the module loads.
vi.hoisted(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const renders = vi.hoisted(() => ({ card: vi.fn(), thumbnail: vi.fn() }));
vi.mock("@dnd-kit/react/sortable", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@dnd-kit/react/sortable")>();
  return {
    ...actual,
    useSortable: (input: Parameters<typeof actual.useSortable>[0]) => {
      renders.card(input.id);
      return actual.useSortable(input);
    },
  };
});
vi.mock("@/components/page-editor/PageThumbnail", async (importOriginal) => {
  const { PageThumbnail } =
    await importOriginal<
      typeof import("@/components/page-editor/PageThumbnail")
    >();
  return {
    PageThumbnail: (props: React.ComponentProps<typeof PageThumbnail>) => {
      renders.thumbnail(props.page.pageIndex);
      return <PageThumbnail {...props} />;
    },
  };
});

vi.mock("@/app/editorRuntime", () => ({
  useEditorDocumentIdentityRuntime: () => ({ workerService: null }),
}));

let host: HTMLDivElement;
let toolbarHost: HTMLDivElement;
let root: Root;
let store: ReturnType<typeof createTestEditorStore>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
  host = document.createElement("div");
  toolbarHost = document.createElement("div");
  document.body.append(toolbarHost, host);
  root = createRoot(host);
  store = createTestEditorStore({
    mode: "pages",
    pages: Array.from({ length: 1000 }, (_, i) => ({
      ...page(i),
      blank: true,
    })),
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  store.dispose();
  host.remove();
  toolbarHost.remove();
  vi.unstubAllGlobals();
});

it("virtualizes long documents without reading a released scroll event", async () => {
  await act(async () =>
    root.render(
      <EditorViewContext.Provider value={store}>
        <LanguageProvider defaultLanguage="en">
          <PageEditor toolbarHost={toolbarHost} />
        </LanguageProvider>
      </EditorViewContext.Provider>,
    ),
  );
  const viewport = host.querySelector<HTMLDivElement>("[data-page-grid]")!;
  const rowHeight = Number(viewport.dataset.gridRowHeight);
  const pageButtons = () =>
    host.querySelectorAll<HTMLButtonElement>("[data-page-drag-handle]");
  expect(pageButtons()[0].getAttribute("aria-label")).toBe("Page 1");
  expect(pageButtons().length).toBeLessThan(40);

  // Two events in one batch force React to process a queued state updater after
  // dispatch has cleared SyntheticEvent.currentTarget.
  await act(async () => {
    viewport.scrollTop = rowHeight * 90;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
    viewport.scrollTop = rowHeight * 100;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  expect(pageButtons()[0].getAttribute("aria-label")).toBe("Page 393");
  expect(pageButtons().length).toBeLessThan(40);

  await act(async () => {
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  expect(pageButtons()[0].getAttribute("aria-label")).toBe("Page 1");
});

it("selects pages with click and modifiers while retaining per-page actions", async () => {
  await act(async () =>
    root.render(
      <EditorViewContext.Provider value={store}>
        <LanguageProvider defaultLanguage="en">
          <PageEditor toolbarHost={toolbarHost} />
        </LanguageProvider>
      </EditorViewContext.Provider>,
    ),
  );
  const toolbar = toolbarHost.querySelector("[data-page-editor-toolbar]")!;
  expect(host.querySelector("[data-page-editor-toolbar]")).toBeNull();
  const grid = host.querySelector("[data-page-grid]")!;
  const bulkRotate = () =>
    toolbar.querySelector<HTMLButtonElement>(
      'button[aria-label="Rotate clockwise 90°"]',
    )!;
  const clickPage = async (index: number, modifiers: MouseEventInit = {}) => {
    await act(async () =>
      grid
        .querySelector(`[data-page-index="${index}"] [data-page-drag-handle]`)!
        .dispatchEvent(
          new MouseEvent("click", { bubbles: true, ...modifiers }),
        ),
    );
  };
  expect(grid.querySelectorAll('[role="checkbox"]')).toHaveLength(0);
  expect(toolbar.querySelector('[role="radiogroup"]')).toBeNull();
  expect(bulkRotate().disabled).toBe(true);
  await clickPage(0);
  expect(store.getState().selectedPageIds).toEqual(["original:0"]);
  expect(bulkRotate().disabled).toBe(false);
  await clickPage(2, { ctrlKey: true });
  expect(store.getState().selectedPageIds).toEqual([
    "original:0",
    "original:2",
  ]);
  expect(bulkRotate().disabled).toBe(false);
  expect(
    grid.querySelectorAll('[aria-label="Rotate clockwise 90°"]'),
  ).toHaveLength(grid.querySelectorAll("[data-page-card]").length);
  await clickPage(4, { metaKey: true });
  expect(store.getState().selectedPageIds).toEqual([
    "original:0",
    "original:2",
    "original:4",
  ]);
  await clickPage(2, { ctrlKey: true });
  expect(store.getState().selectedPageIds).toEqual([
    "original:0",
    "original:4",
  ]);
  await clickPage(5, { shiftKey: true });
  expect(store.getState().selectedPageIds).toEqual([
    "original:2",
    "original:3",
    "original:4",
    "original:5",
  ]);
  await clickPage(7, { shiftKey: true, ctrlKey: true });
  expect(store.getState().selectedPageIds).toEqual([
    "original:2",
    "original:3",
    "original:4",
    "original:5",
    "original:6",
    "original:7",
  ]);
  await clickPage(6);
  expect(store.getState().selectedPageIds).toEqual(["original:6"]);
  expect(bulkRotate().disabled).toBe(false);
  await act(async () => store.getState().setSelectedPageIds([]));
  expect(bulkRotate().disabled).toBe(true);
});

it("deletes the menu's page or selected group, supports undo/redo, and keeps at least one page", async () => {
  store.setState({
    pages: [page(0), page(1), page(2)],
    selectedPageIds: ["original:0"],
  });
  await act(async () =>
    root.render(
      <EditorViewContext.Provider value={store}>
        <LanguageProvider defaultLanguage="en">
          <PageEditor toolbarHost={toolbarHost} />
        </LanguageProvider>
      </EditorViewContext.Provider>,
    ),
  );
  const menuDelete = async (index: number) => {
    await act(async () =>
      host
        .querySelector(`[data-page-index="${index}"] [data-page-drag-handle]`)!
        .dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            button: 2,
          }),
        ),
    );
    return Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((e) => e.textContent === "Delete")!;
  };
  const removeOtherPage = await menuDelete(2);
  expect(removeOtherPage).toBeDefined();
  await act(async () => removeOtherPage.click());
  expect(store.getState().pages.map((p) => p.id)).toEqual([
    "original:0",
    "original:1",
  ]);
  await act(async () => store.getState().undo());
  expect(store.getState().pages).toHaveLength(3);
  await act(async () =>
    store
      .getState()
      .setSelectedPageIds(["original:0", "original:1", "original:2"]),
  );
  const allPages = await menuDelete(1);
  expect(allPages.hasAttribute("data-disabled")).toBe(true);
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await act(async () =>
    store.getState().setSelectedPageIds(["original:0", "original:2"]),
  );
  const removeGroup = await menuDelete(0);
  await act(async () => removeGroup.click());
  expect(store.getState().pages.map((p) => p.id)).toEqual(["original:1"]);
  const lastPage = await menuDelete(0);
  expect(lastPage.hasAttribute("data-disabled")).toBe(true);
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await act(async () => store.getState().undo());
  expect(store.getState().pages).toHaveLength(3);
  await act(async () => store.getState().redo());
  expect(store.getState().pages.map((p) => p.id)).toEqual(["original:1"]);
});

it("keeps single-page rotation anchored to the edited page after scrolling", async () => {
  await act(async () =>
    root.render(
      <EditorViewContext.Provider value={store}>
        <LanguageProvider defaultLanguage="en">
          <PageEditor toolbarHost={toolbarHost} />
        </LanguageProvider>
      </EditorViewContext.Provider>,
    ),
  );
  const viewport = host.querySelector<HTMLDivElement>("[data-page-grid]")!;
  const rowHeight = Number(viewport.dataset.gridRowHeight);
  await act(async () => {
    viewport.scrollTop = rowHeight * 100;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const rotate = host.querySelector<HTMLButtonElement>(
    '[data-page-index="400"] button[aria-label="Rotate clockwise 90°"]',
  )!;
  await act(async () => rotate.click());
  expect(store.getState().pages[400].rotationDelta).toBe(90);
  expect(viewport.scrollTop).toBe(rowHeight * 100);
});

it("zooms the virtual grid around the visible pages without editing or zooming the PDF", async () => {
  store.setState({ selectedPageIds: ["original:0"] });
  await act(async () =>
    root.render(
      <EditorViewContext.Provider value={store}>
        <LanguageProvider defaultLanguage="en">
          <PageEditor toolbarHost={toolbarHost} />
        </LanguageProvider>
      </EditorViewContext.Provider>,
    ),
  );
  const viewport = host.querySelector<HTMLDivElement>("[data-page-grid]")!;
  const rowHeight = Number(viewport.dataset.gridRowHeight);
  const readingScale = store.getState().scale;
  await act(async () => {
    viewport.scrollTop = rowHeight * 100;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const plainWheel = new WheelEvent("wheel", {
    deltaY: -100,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => viewport.dispatchEvent(plainWheel));
  expect(plainWheel.defaultPrevented).toBe(false);
  expect(store.getState().pageThumbnailScale).toBe(1);

  for (const modifier of ["ctrlKey", "metaKey"]) {
    const wheel = new WheelEvent("wheel", {
      [modifier]: true,
      deltaY: -100,
      clientY: 50,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      viewport.dispatchEvent(wheel);
      await new Promise(requestAnimationFrame);
    });
    expect(wheel.defaultPrevented).toBe(true);
  }
  expect(store.getState().pageThumbnailScale).toBeGreaterThan(1);
  expect(Number(viewport.dataset.gridColumns)).toBeLessThan(4);
  expect(Number(viewport.dataset.gridRowHeight)).toBeGreaterThan(rowHeight);
  expect(viewport.querySelector('[data-page-index="400"]')).not.toBeNull();

  await act(async () => store.getState().setPageThumbnailScale(0.5));
  expect(Number(viewport.dataset.gridColumns)).toBeGreaterThan(4);
  expect(viewport.querySelectorAll("[data-page-card]").length).toBeLessThan(50);
  expect(viewport.scrollTop).toBeGreaterThan(1000);
  expect(store.getState().scale).toBe(readingScale);
  expect(store.getState().selectedPageIds).toEqual(["original:0"]);
  expect(store.getState().past).toHaveLength(0);
  expect(store.getState().isDirty).toBe(false);
});

it("updates only affected cards and thumbnails during selection, caching and zoom", async () => {
  store.setState({ selectedPageIds: ["original:0"] });
  await act(async () =>
    root.render(
      <EditorViewContext.Provider value={store}>
        <LanguageProvider defaultLanguage="en">
          <PageEditor toolbarHost={toolbarHost} />
        </LanguageProvider>
      </EditorViewContext.Provider>,
    ),
  );
  const viewport = host.querySelector<HTMLDivElement>("[data-page-grid]")!;
  renders.card.mockClear();
  renders.thumbnail.mockClear();
  await act(async () => store.getState().setSelectedPageIds(["original:1"]));
  expect(new Set(renders.card.mock.calls.map(([id]) => id))).toEqual(
    new Set(["original:0", "original:1"]),
  );
  expect(renders.thumbnail).not.toHaveBeenCalled();

  renders.card.mockClear();
  await act(async () =>
    store.setState({ thumbnailImages: { 3: "blob:page-3" } }),
  );
  expect(renders.card).not.toHaveBeenCalled();
  expect(renders.thumbnail.mock.calls).toEqual([[3]]);

  renders.thumbnail.mockClear();
  await act(async () => store.getState().setPageThumbnailScale(1.1));
  expect(renders.card).not.toHaveBeenCalled();
  expect(renders.thumbnail).not.toHaveBeenCalled();
  await act(async () => {
    viewport.scrollTop = 4;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  expect(renders.card).not.toHaveBeenCalled();
});

it("coalesces wheel input per frame and discards pending zoom after a preset or unmount", async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const flush = async () =>
    act(async () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(0));
    });
  await act(async () =>
    root.render(
      <EditorViewContext.Provider value={store}>
        <LanguageProvider defaultLanguage="en">
          <PageEditor toolbarHost={toolbarHost} />
        </LanguageProvider>
      </EditorViewContext.Provider>,
    ),
  );
  const viewport = host.querySelector<HTMLDivElement>("[data-page-grid]")!;
  const wheel = () =>
    viewport.dispatchEvent(
      new WheelEvent("wheel", {
        ctrlKey: true,
        deltaY: -5,
        bubbles: true,
        cancelable: true,
      }),
    );
  const zoomed = vi.fn();
  const unsubscribe = store.subscribe((next, previous) => {
    if (next.pageThumbnailScale !== previous.pageThumbnailScale) zoomed();
  });
  await act(async () => {
    for (let i = 0; i < 20; i++) wheel();
  });
  expect(zoomed).not.toHaveBeenCalled();
  await flush();
  expect(zoomed).toHaveBeenCalledTimes(1);
  expect(store.getState().pageThumbnailScale).toBeCloseTo(1.25);

  await act(async () => {
    wheel();
    store.getState().setPageThumbnailScale(0.75);
  });
  await flush();
  expect(store.getState().pageThumbnailScale).toBe(0.75);
  await act(async () => {
    wheel();
    root.render(null);
  });
  await flush();
  expect(store.getState().pageThumbnailScale).toBe(0.75);
  unsubscribe();
});

it("validates bulk selection in linear work and skips identical selections", () => {
  let reads = 0;
  const ids = Array.from({ length: 1000 }, (_, i) => `page-${i}`);
  store.setState({
    pages: ids.map((id, i) => ({
      ...page(i),
      get id() {
        reads++;
        return id;
      },
    })),
  });
  const changed = vi.fn();
  const unsubscribe = store.subscribe(changed);
  store.getState().setSelectedPageIds([...ids, ids[0], "missing"]);
  expect(store.getState().selectedPageIds).toEqual(ids);
  expect(reads).toBeLessThanOrEqual(ids.length * 2);
  expect(changed).toHaveBeenCalledTimes(1);
  store.getState().setSelectedPageIds(ids);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(store.getState().past).toHaveLength(0);
  unsubscribe();
});
