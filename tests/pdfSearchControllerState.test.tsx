import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EditorPdfSearchProviders,
  useEditorPdfSearchSidebar,
  useEditorPdfSearchToolbar,
  useEditorPdfSearchWorkspace,
} from "@/app/editorShellContext";
import { usePdfSearchController } from "@/pages/EditorPage/hooks/usePdfSearchController";
import { resolvePdfSearchResultGeometry } from "@/components/workspace/lib/pdfTextRangeGeometry";
import { appEventBus } from "@/lib/eventBus";
import { useEditorStore } from "@/store/useEditorStore";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import type { PageData, PDFSearchResult } from "@/types";
import { page } from "./helpers/editorStore";

// These tests exercise the real search controller, external subscription and
// Context providers. The text matcher/geometry backend is deterministic so late
// worker completion, rejection and cancellation can be tested without a PDF.
vi.mock("@/lib/pdfSearch", () => ({
  findPdfSearchResults: (
    content: { tag: string },
    query: string,
    data: PageData,
  ): PDFSearchResult[] => [
    {
      id: `${content.tag}-${query}-${data.pageIndex}`,
      pageIndex: data.pageIndex,
      matchIndexOnPage: 0,
      startOffset: 0,
      endOffset: query.length,
      matchText: query,
      contextBefore: "",
      contextAfter: "",
      displaySegments: [],
    },
  ],
}));
vi.mock("@/components/workspace/lib/pdfTextRangeGeometry", () => ({
  resolvePdfSearchResultGeometry: vi.fn(async () => null),
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const t = (key: string) => key;
const renders = { toolbar: 0, sidebar: 0, workspace: 0, shell: 0 };
const resetCounts = () => {
  for (const key of Object.keys(renders) as Array<keyof typeof renders>)
    renders[key] = 0;
};
const ToolbarProbe = React.memo(function ToolbarProbe() {
  useEditorPdfSearchToolbar();
  renders.toolbar++;
  return null;
});
const SidebarProbe = React.memo(function SidebarProbe() {
  useEditorPdfSearchSidebar();
  renders.sidebar++;
  return null;
});
const WorkspaceProbe = React.memo(function WorkspaceProbe() {
  useEditorPdfSearchWorkspace();
  renders.workspace++;
  return null;
});
const ShellProbe = React.memo(function ShellProbe() {
  renders.shell++;
  return null;
});
let controller: ReturnType<typeof usePdfSearchController>;
function Harness({
  pages,
  worker,
  children,
}: {
  pages: PageData[];
  worker: PDFWorkerService;
  children: React.ReactNode;
}) {
  const sidebarOpen = useEditorStore((state) => state.isSidebarOpen);
  const { openSidebar, closeSidebar } = useEditorStore.getState();
  controller = usePdfSearchController({
    pages,
    workerService: worker,
    sidebarOpen,
    openSidebar,
    closeSidebar,
    t,
  });
  return (
    <EditorPdfSearchProviders controller={controller}>
      {children}
    </EditorPdfSearchProviders>
  );
}

let root: Root;
let container: HTMLDivElement;
let pages: PageData[];
let worker: PDFWorkerService;
let children: React.ReactElement;
const renderHarness = async () => {
  await act(async () =>
    root.render(
      <Harness pages={pages} worker={worker}>
        {children}
      </Harness>,
    ),
  );
};
const search = async (query = "alpha") => {
  await act(async () => {
    controller.openPdfSearch();
    controller.setPdfSearchQuery(query);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
};
const makeWorker = (tag: string) =>
  ({
    getTextContent: vi.fn(async () => ({ tag })),
  }) as unknown as PDFWorkerService;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.mocked(resolvePdfSearchResultGeometry).mockResolvedValue(null);
  useEditorStore.setState(
    {
      ...useEditorStore.getInitialState(),
      isSidebarOpen: false,
      isRightPanelOpen: true,
      isPanelFloating: true,
    },
    true,
  );
  pages = [page(0), page(1)];
  worker = makeWorker("A");
  children = (
    <>
      <ToolbarProbe />
      <SidebarProbe />
      <WorkspaceProbe />
      <ShellProbe />
    </>
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await renderHarness();
  resetCounts();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PDF search subscriptions, context boundaries and cancellation", () => {
  it("isolates typing from Toolbar/shell and publishes workspace changes only for results/selection", async () => {
    await act(async () => controller.openPdfSearch());
    resetCounts();
    for (const query of ["a", "al", "alp", "alph", "alpha"]) {
      await act(async () => controller.setPdfSearchQuery(query));
    }
    expect(renders.sidebar).toBeGreaterThan(0);
    expect(renders.toolbar).toBe(0);
    expect(renders.shell).toBe(0);
    expect(renders.workspace).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(renders.workspace).toBeGreaterThan(0);
    expect(renders.toolbar).toBe(0);
    expect(controller.pdfSearchResults).toHaveLength(2);
    resetCounts();
    await act(async () => controller.handleSelectNextPdfSearchResult());
    expect(renders.workspace).toBeGreaterThan(0);
    expect(renders.toolbar).toBe(0);
  });

  it("uses the latest current page without a reactive viewport subscription", async () => {
    await act(async () => {
      controller.openPdfSearch();
      controller.setPdfSearchQuery("alpha");
    });
    resetCounts();
    await act(async () => {
      useEditorStore.setState({ currentPageIndex: 1 });
      useEditorStore.getState().setScale(2);
      useEditorStore.getState().setUiState({ rightPanelWidth: 450 });
    });
    expect(renders).toEqual({ toolbar: 0, sidebar: 0, workspace: 0, shell: 0 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(controller.activePdfSearchResultId).toBe("A-alpha-1");
  });

  it("uses panel actions and restores the sidebar's pre-search open state", async () => {
    await search();
    expect(useEditorStore.getState()).toMatchObject({
      isSidebarOpen: true,
      isRightPanelOpen: false,
    });
    await act(async () => controller.closePdfSearch());
    expect(useEditorStore.getState().isSidebarOpen).toBe(false);
    await act(async () => useEditorStore.getState().openSidebar());
    await search();
    await act(async () => controller.closePdfSearch());
    expect(useEditorStore.getState().isSidebarOpen).toBe(true);
  });

  it("ignores a stale worker rejection after a document switch", async () => {
    const pending = deferred<{ tag: string }>();
    const signals: AbortSignal[] = [];
    worker = {
      getTextContent: vi.fn(({ signal }: { signal: AbortSignal }) => {
        signals.push(signal);
        return pending.promise;
      }),
    } as unknown as PDFWorkerService;
    await renderHarness();
    await search();
    expect(controller.isPdfSearchLoading).toBe(true);
    worker = makeWorker("B");
    await renderHarness();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await act(async () => pending.reject(new Error("late failure from A")));
    expect(controller.pdfSearchError).toBeNull();
    expect(controller.isPdfSearchLoading).toBe(false);
    expect(controller.pdfSearchResults[0].id).toBe("B-alpha-0");
  });

  it("does not navigate the new document when old result geometry resolves late", async () => {
    await search();
    const geometry = deferred<null>();
    vi.mocked(resolvePdfSearchResultGeometry).mockReturnValue(geometry.promise);
    const emit = vi.spyOn(appEventBus, "emit");
    await act(async () =>
      controller.handleSelectPdfSearchResult(controller.pdfSearchResults[0]),
    );
    const signal = vi
      .mocked(resolvePdfSearchResultGeometry)
      .mock.calls.at(-1)?.[0].signal;
    worker = makeWorker("B");
    await renderHarness();
    expect(signal?.aborted).toBe(true);
    await act(async () => geometry.resolve(null));
    expect(emit).not.toHaveBeenCalled();
  });

  it("rejects an old close-search animation callback after switching workers", async () => {
    await search();
    let frame: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frame = callback;
      return 1;
    });
    await act(async () => controller.closePdfSearch());
    worker = makeWorker("B");
    await renderHarness();
    vi.mocked(resolvePdfSearchResultGeometry).mockClear();
    await act(async () => frame?.(0));
    expect(resolvePdfSearchResultGeometry).not.toHaveBeenCalled();
  });
});
