import React, { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import PageEditor from "@/components/page-editor/PageEditor";
import { PageDragPreview } from "@/components/page-editor/PageDragPreview";
import { LanguageProvider } from "@/components/language-provider";
import { EditorViewContext } from "@/store/useEditorView";
import { createTestEditorStore, page } from "./helpers/editorStore";

const drag = vi.hoisted(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const handlers: {
    start: (id: string) => void;
    over: (id: string) => void;
    end: () => void;
  } = {
    start: () => {},
    over: () => {},
    end: () => {},
  };
  return handlers;
});
const cardRenders = vi.hoisted(() => vi.fn());

// Keep the preview active while the document store commits, as can happen
// before dnd-kit's drop animation flushes React's queued preview cleanup.
vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: ({
    children,
    onDragStart,
    onDragOver,
    onDragEnd,
  }: {
    children: ReactNode;
    onDragStart: (event: { operation: { source: { id: string } } }) => void;
    onDragOver: (event: { operation: { target: { id: string } } }) => void;
    onDragEnd: (event: {
      canceled: boolean;
      operation: { target: { id: string } };
    }) => void;
  }) => {
    drag.start = (id) => onDragStart({ operation: { source: { id } } });
    drag.over = (id) => onDragOver({ operation: { target: { id } } });
    drag.end = () =>
      onDragEnd({ canceled: false, operation: { target: { id: "page-2" } } });
    return children;
  },
  DragOverlay: () => null,
}));
vi.mock("@dnd-kit/react/sortable", () => ({
  useSortable: ({ id }: { id: string }) => {
    cardRenders(id);
    return { ref: () => {}, handleRef: () => {} };
  },
}));
vi.mock("@/app/editorRuntime", () => ({
  useEditorDocumentIdentityRuntime: () => ({ workerService: null }),
}));

afterEach(() => vi.unstubAllGlobals());

it.each([
  { selectedPageIds: [] },
  { selectedPageIds: ["page-0"] },
  { selectedPageIds: ["page-0", "page-1"] },
])(
  "only rerenders moving cards on pickup with selection $selectedPageIds",
  async ({ selectedPageIds }) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
    const store = createTestEditorStore({
      mode: "pages",
      selectedPageIds,
      pages: Array.from({ length: 20 }, (_, i) => ({
        ...page(i),
        id: `page-${i}`,
        blank: true,
      })),
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <EditorViewContext.Provider value={store}>
            <LanguageProvider defaultLanguage="en">
              <PageEditor />
            </LanguageProvider>
          </EditorViewContext.Provider>,
        ),
      );
      cardRenders.mockClear();
      await act(async () => drag.start("page-0"));
      const moving = selectedPageIds.length ? selectedPageIds : ["page-0"];
      expect(new Set(cardRenders.mock.calls.map(([id]) => id))).toEqual(
        new Set(moving),
      );
      expect(cardRenders).toHaveBeenCalledTimes(moving.length);
      expect(store.getState().selectedPageIds).toEqual(moving);
      expect(store.getState().past).toHaveLength(0);
    } finally {
      await act(async () => root.unmount());
      store.dispose();
      host.remove();
    }
  },
);

it("keeps each thumbnail and image node when page indices commit ahead of the drag preview", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
  const store = createTestEditorStore({
    mode: "pages",
    pages: Array.from({ length: 4 }, (_, i) => ({
      ...page(i),
      id: `page-${i}`,
    })),
    thumbnailImages: Object.fromEntries(
      Array.from({ length: 4 }, (_, i) => [i, `blob:page-${i}`]),
    ),
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const cards = () => [
    ...host.querySelectorAll<HTMLElement>("[data-page-card]"),
  ];
  const images = () =>
    new Map(
      cards().map((card) => [
        card.dataset.pageCard,
        card.querySelector("img")!,
      ]),
    );
  const assertImages = (initial: ReturnType<typeof images>) => {
    for (const [id, image] of images()) {
      expect(image, `image node for ${id}`).toBe(initial.get(id));
      expect(image.getAttribute("src"), `thumbnail for ${id}`).toBe(
        `blob:${id}`,
      );
    }
  };
  try {
    await act(async () =>
      root.render(
        <EditorViewContext.Provider value={store}>
          <LanguageProvider defaultLanguage="en">
            <PageEditor />
          </LanguageProvider>
        </EditorViewContext.Provider>,
      ),
    );
    const initial = images();
    await act(async () => drag.start("page-0"));
    await act(async () => drag.over("page-2"));
    expect(cards().map((card) => card.dataset.pageCard)).toEqual([
      "page-1",
      "page-2",
      "page-0",
      "page-3",
    ]);
    assertImages(initial);

    const untouched = store.getState().pages[3];
    cardRenders.mockClear();
    await act(async () => store.getState().movePages(["page-0"], 3));
    expect(store.getState().pages[3]).toBe(untouched);
    expect(cardRenders.mock.calls.map(([id]) => id)).not.toContain("page-3");
    expect(cards().map((card) => card.dataset.pageCard)).toEqual([
      "page-1",
      "page-2",
      "page-0",
      "page-3",
    ]);
    assertImages(initial);

    await act(async () => drag.end());
    expect(store.getState().past).toHaveLength(1);
    await act(async () => store.getState().undo());
    expect(cards().map((card) => card.dataset.pageCard)).toEqual([
      "page-0",
      "page-1",
      "page-2",
      "page-3",
    ]);
    assertImages(initial);
  } finally {
    await act(async () => root.unmount());
    store.dispose();
    host.remove();
  }
});

it("fills a cold drag preview from the shared cache and preserves captured images through reorder", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const pages = [page(0), page(1), page(2)];
  const store = createTestEditorStore({ pages });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const front = () => host.querySelector("[data-page-drag-front] img");
  const backing = () => host.querySelector("[data-page-drag-stack] img");
  try {
    await act(async () =>
      root.render(
        <EditorViewContext.Provider value={store}>
          <LanguageProvider defaultLanguage="en">
            <PageDragPreview
              preview={{
                page: pages[0],
                count: 2,
                stack: [{ page: pages[1], image: "blob:captured" }],
              }}
            />
          </LanguageProvider>
        </EditorViewContext.Provider>,
      ),
    );
    expect(front()).toBeNull();
    await act(async () =>
      store.setState({
        thumbnailImages: { 0: "blob:ready", 1: "blob:refreshed" },
      }),
    );
    expect(front()?.getAttribute("src")).toBe("blob:ready");
    expect(backing()?.getAttribute("src")).toBe("blob:captured");
    const image = front();
    await act(async () => store.getState().movePages(["original:0"], 3));
    expect(front()).toBe(image);
    expect(front()?.getAttribute("src")).toBe("blob:ready");
    expect(backing()?.getAttribute("src")).toBe("blob:captured");
  } finally {
    await act(async () => root.unmount());
    store.dispose();
    host.remove();
  }
});
