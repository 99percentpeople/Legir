import React, { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import AppRoutes from "@/AppRoutes";
import { EditorRuntimeProvider } from "@/app/editorRuntime";
import { useEditorTabsController } from "@/app/editorTabs/useEditorTabsController";
import { createLocalSingleWindowTabBackend } from "@/app/editorTabs/backend";
import { createEditorTabSnapshotFromState } from "@/app/editorTabs/storeSnapshot";
import { useEditorCloseFlow } from "@/app/useEditorCloseFlow";
import {
  documentTabPath,
  parseWorkspacePage,
  useWorkspaceNavigation,
} from "@/app/workspaceNavigation/useWorkspaceNavigation";
import {
  activateEditorView,
  getActiveEditorView,
  useEditorView,
  windowEditorView,
} from "@/store/useEditorView";
import { useEventListener } from "@/hooks/useEventListener";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import type { HomePageProps } from "@/pages/HomePage";
import { createTestEditorStore, page } from "./helpers/editorStore";

const probes = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
vi.mock("@/pages/EditorPage/index", () => ({
  default: function EditorProbe() {
    const filename = useEditorView((state) => state.filename);
    const [keys, setKeys] = React.useState(0);
    useEventListener(window, "keydown", () => setKeys((value) => value + 1));
    React.useEffect(() => {
      probes.mount(filename);
      return () => probes.unmount(filename);
    }, []);
    return (
      <>
        <canvas data-document={filename} />
        <span data-keys={filename}>{keys}</span>
      </>
    );
  },
}));
vi.mock("@/pages/HomePage", () => ({
  default: function HomeProbe({ isActive }: HomePageProps) {
    const [count, setCount] = React.useState(0);
    return (
      <button
        data-home-content
        data-home-active={isActive}
        onClick={() => setCount(count + 1)}
      >
        {count}
      </button>
    );
  },
}));

let host: HTMLDivElement;
let root: Root;
let tabs: ReturnType<typeof useEditorTabsController>;
let navigation: ReturnType<typeof useWorkspaceNavigation>;
let closeFlow: ReturnType<typeof useEditorCloseFlow>;
let location: ReturnType<typeof memoryLocation<unknown>> & {
  history: string[];
};
let backend: ReturnType<typeof createLocalSingleWindowTabBackend>;
const capture = vi.fn();
const save = vi.fn(async () => true);
const destroyWindow = vi.fn(async () => {});

function Harness({ loading = false }: { loading?: boolean }) {
  tabs = useEditorTabsController({
    backend,
    windowId: "w",
    persistDocumentView: capture,
    activateSession: (session) => {
      for (const tab of backend.getWindowSnapshot("w").sessions)
        tab.runtime.active = tab.id === session.id;
      activateEditorView(session.runtime.store);
    },
  });
  navigation = useWorkspaceNavigation({ ...tabs, windowId: "w" });
  useLayoutEffect(
    () => navigation.reconcile(loading),
    [navigation.location, tabs.tabs, loading],
  );
  const activeTabId =
    navigation.page?.kind === "document" ? navigation.page.tabId : null;
  closeFlow = useEditorCloseFlow({
    activeTabId,
    activateTab: navigation.openTab,
    persistActiveTabView: tabs.persistActiveTabView,
    closeAllTabsAndWindow: destroyWindow,
    closeAllTabsToLanding: () => {
      tabs.disposeAllTabs();
      navigation.showHome({ replace: true });
    },
    closeTabImmediately: navigation.closeTabImmediately,
    getTabById: tabs.getTabById,
    getTabsSnapshot: tabs.getTabsSnapshot,
    navigateToHome: () => navigation.showHome({ replace: true }),
    runPrimarySaveAction: save,
  });
  return (
    <EditorRuntimeProvider
      tabs={{
        sessions: tabs.tabs,
        tabs: tabs.tabDescriptors,
        windowId: "w",
        activeTabId,
        mergeWindowTargets: [],
        canDetachTabs: false,
        canMergeTabs: false,
        refreshMergeWindowTargets: async () => {},
        selectTab: navigation.openTab,
        closeTab: (id) => {
          void closeFlow.requestCloseTab(id);
        },
        moveTab: () => {},
        detachTab: async () => {},
        mergeTabToWindow: async () => {},
      }}
      document={{
        sessionRenderKey: activeTabId,
        workerService: null,
        isFileDragActive: false,
        save,
        saveAs: save,
        exit: () => {},
        print: () => {},
        requestCloseCurrentTab: () => {},
      }}
    >
      <AppRoutes
        page={navigation.page}
        showHome={navigation.showHome}
        homeProps={{ adapter: {} as HomePageProps["adapter"] }}
      />
    </EditorRuntimeProvider>
  );
}

async function mount(path = "/", loading = false) {
  location = memoryLocation({ path, record: true });
  await act(async () =>
    root.render(
      <Router hook={location.hook}>
        <Harness loading={loading} />
      </Router>,
    ),
  );
}

async function add(id: string, dirty = false) {
  const seed = createTestEditorStore({
    filename: `${id}.pdf`,
    pages: [page(0)],
    isDirty: dirty,
  });
  const snapshot = createEditorTabSnapshotFromState({
    state: seed.getState(),
    scrollContainer: null,
  });
  seed.dispose();
  await act(async () => {
    tabs.addTab({
      id,
      title: id,
      sourceKey: null,
      snapshot,
      workerService: { destroy: vi.fn() } as unknown as PDFWorkerService,
      activate: false,
    });
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  backend = createLocalSingleWindowTabBackend();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  save.mockResolvedValue(true);
});
afterEach(async () => {
  await act(async () => {
    tabs?.disposeAllTabs();
    root.unmount();
  });
  backend.dispose();
  host.remove();
  activateEditorView();
  vi.unstubAllGlobals();
});

describe("workspace navigation", () => {
  it("shares Home and document tab styling without making Home draggable or closeable", async () => {
    await mount();
    await add("A");
    const home = Array.from(
      host.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "tabs.home")!;
    const documentTab = host.querySelector<HTMLElement>(
      '[data-editor-tab-id="A"]',
    )!;
    const activeClassName = home.className;
    const inactiveClassName = documentTab.className;

    expect(home.classList.contains("editor-tab--active")).toBe(true);
    expect(documentTab.classList.contains("editor-tab--active")).toBe(false);
    expect(home.classList.contains("editor-tab")).toBe(true);
    expect(documentTab.classList.contains("editor-tab")).toBe(true);
    expect(
      documentTab.parentElement?.classList.contains("editor-tab-slot"),
    ).toBe(true);
    expect(documentTab.closest(".editor-tab-scroller")).not.toBeNull();
    expect(home.closest(".editor-tab-scroller")).toBeNull();
    expect(home.draggable).toBe(false);
    expect(home.querySelector("button")).toBeNull();
    expect(home.getAttribute("aria-current")).toBe("page");
    expect(documentTab.draggable).toBe(true);
    expect(documentTab.querySelector("button")).not.toBeNull();

    await act(async () => documentTab.click());
    expect(home.className).toBe(inactiveClassName);
    expect(documentTab.className).toBe(activeClassName);
    expect(documentTab.getAttribute("aria-current")).toBe("page");

    await act(async () => home.click());
    expect(home.className).toBe(activeClassName);
    expect(documentTab.className).toBe(inactiveClassName);
    expect(navigation.page).toEqual({ kind: "home" });
  });

  it("round-trips IDs without exposing file paths and rejects malformed routes", () => {
    expect(parseWorkspacePage(documentTabPath("tab /?#%"))).toEqual({
      kind: "document",
      tabId: "tab /?#%",
    });
    expect(parseWorkspacePage("/editor/%E0%A4")).toBeNull();
    expect(parseWorkspacePage("/editor/a/b")).toBeNull();
  });

  it("keeps Home and document trees alive and disables every document on Home", async () => {
    await mount();
    const home = host.querySelector<HTMLButtonElement>("[data-home-content]")!;
    await act(async () => home.click());
    await add("A", true);
    expect(tabs.activeTabId).toBeNull();
    await act(async () => navigation.openTab("A"));
    // The real document host is lazy-loaded. Wait for its mounted probe before
    // sending input; a loaded route alone does not mean its event hooks exist.
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(host.querySelector('[data-document="A.pdf"]')).not.toBeNull();
    });
    const canvas = host.querySelector('[data-document="A.pdf"]');
    const store = tabs.getTabById("A")!.runtime.store;
    await act(async () => {
      store.setState({ scale: 2 });
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
      navigation.showHome();
    });
    expect(navigation.page).toEqual({ kind: "home" });
    expect(tabs.activeTabId).toBeNull();
    expect(getActiveEditorView()).toBe(windowEditorView);
    expect(store.getState().isDirty).toBe(true);
    expect(
      host.querySelector('[data-editor-tab="A"]')?.hasAttribute("inert"),
    ).toBe(true);
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" })),
    );
    expect(host.querySelector('[data-keys="A.pdf"]')?.textContent).toBe("1");
    expect(host.querySelector("[data-home-content]")).toBe(home);
    expect(home.textContent).toBe("1");
    await act(async () => navigation.openTab("A"));
    expect(host.querySelector('[data-document="A.pdf"]')).toBe(canvas);
    expect(store.getState().scale).toBe(2);
    expect(probes.unmount).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalled();
  });

  it("records explicit navigation once and projects external history navigation without pushing", async () => {
    await mount();
    await add("A");
    await add("B");
    await act(async () => navigation.openTab("A"));
    await act(async () => navigation.openTab("B"));
    const length = location.history.length;
    await act(async () => navigation.openTab("B"));
    expect(location.history).toEqual(["/", "/editor/A", "/editor/B"]);
    await act(async () => location.navigate("/editor/A", { replace: true }));
    expect(location.history).toHaveLength(length);
    expect(tabs.activeTabId).toBe("A");
    await act(async () => location.navigate("/", { replace: true }));
    expect(tabs.activeTabId).toBeNull();
    await act(async () => location.navigate("/editor/B", { replace: true }));
    expect(tabs.activeTabId).toBe("B");
  });

  it("normalizes old and expired addresses, waiting for bootstrap before redirecting", async () => {
    await mount("/editor", true);
    expect(navigation.page).toBeNull();
    expect(location.history).toEqual(["/editor"]);
    await add("A");
    await act(async () => navigation.openTab("A"));
    expect(location.history).toEqual(["/editor/A"]);
    await act(async () =>
      root.render(
        <Router hook={location.hook}>
          <Harness />
        </Router>,
      ),
    );
    await act(async () => location.navigate("/editor"));
    expect(navigation.location).toBe("/editor/A");
    await act(async () => location.navigate("/editor/missing"));
    expect(navigation.location).toBe("/");
    expect(tabs.activeTabId).toBeNull();
    await act(async () => location.navigate("/unknown"));
    expect(navigation.location).toBe("/");
  });

  it("does not focus a document from another window", async () => {
    await mount();
    await add("A");
    await act(async () =>
      backend.moveSession({
        sessionId: "A",
        fromWindowId: "w",
        toWindowId: "other",
      }),
    );
    await act(async () => {
      expect(navigation.openTab("A")).toBe(false);
      location.navigate("/editor/A");
    });
    expect(navigation.location).toBe("/");
    const foreign = backend.clearWindow("other")[0];
    foreign.runtime.dispose();
  });

  it.each(["/editor", "/editor/expired"])(
    "returns a fresh window at %s to Home",
    async (path) => {
      await mount(path);
      expect(navigation.location).toBe("/");
      expect(tabs.activeTabId).toBeNull();
      expect(location.history).toEqual(["/"]);
    },
  );

  it("returns a failed bootstrap to Home after loading settles", async () => {
    await mount("/editor", true);
    expect(navigation.location).toBe("/editor");
    await act(async () =>
      root.render(
        <Router hook={location.hook}>
          <Harness />
        </Router>,
      ),
    );
    expect(navigation.location).toBe("/");
    expect(location.history).toEqual(["/"]);
  });

  it("preserves Home during reorder and passive transfer rollback", async () => {
    await mount();
    await add("A");
    await add("B");
    await act(async () => tabs.moveTabToWindow("B", "w", 0));
    expect(tabs.windowLayout.tabIds).toEqual(["B", "A"]);
    expect(tabs.activeTabId).toBeNull();
    const original = tabs.getTabById("A")!;
    await act(async () => backend.removeSession("w", "A"));
    await act(async () =>
      backend.addSession("w", original, { activate: false, targetIndex: 1 }),
    );
    expect(tabs.activeTabId).toBeNull();
    expect(navigation.location).toBe("/");
    expect(tabs.getTabById("A")!.runtime).toBe(original.runtime);
  });

  it("closes the active document onto its right then left neighbor using replace", async () => {
    await mount();
    await add("A");
    await add("B");
    await add("C");
    await act(async () => navigation.openTab("B"));
    const length = location.history.length;
    const worker = tabs.getTabById("B")!.workerService;
    await act(async () => closeFlow.requestCloseTab("B"));
    expect(navigation.location).toBe("/editor/C");
    expect(location.history).toHaveLength(length);
    expect(worker.destroy).toHaveBeenCalledOnce();
    await act(async () => closeFlow.requestCloseTab("C"));
    expect(navigation.location).toBe("/editor/A");
    await act(async () => closeFlow.requestCloseTab("A"));
    expect(navigation.location).toBe("/");
    expect(host.querySelectorAll("[data-editor-tab-id]")).toHaveLength(0);
    expect(host.querySelector('[aria-current="page"]')?.textContent).toContain(
      "tabs.home",
    );
  });

  it("does not leave Home when closing a clean background tab", async () => {
    await mount();
    await add("A");
    await add("B");
    await act(async () => closeFlow.requestCloseTab("A"));
    expect(navigation.location).toBe("/");
    expect(tabs.activeTabId).toBeNull();
    expect(tabs.tabs).toHaveLength(1);
  });

  it("navigates to dirty close targets, preserves cancel/failure and closes only after success", async () => {
    await mount();
    await add("A", true);
    await act(async () => closeFlow.requestCloseTab("A"));
    expect(navigation.location).toBe("/editor/A");
    expect(closeFlow.pendingCloseRequest?.currentTabId).toBe("A");
    await act(async () => closeFlow.dismissCloseRequest());
    expect(tabs.tabs).toHaveLength(1);
    expect(navigation.location).toBe("/editor/A");
    await act(async () => closeFlow.requestCloseTab("A"));
    save.mockResolvedValueOnce(false);
    await act(async () => closeFlow.resolveCloseRequest(true));
    expect(closeFlow.pendingCloseRequest).not.toBeNull();
    expect(tabs.tabs).toHaveLength(1);
    await act(async () => closeFlow.resolveCloseRequest(true));
    expect(tabs.tabs).toHaveLength(0);
    expect(navigation.location).toBe("/");
  });

  it("protects dirty background documents when the desktop window closes from Home", async () => {
    await mount();
    await add("A", true);
    await add("B");
    const preventDefault = vi.fn();
    await act(async () =>
      closeFlow.onDesktopCloseRequested({ preventDefault }),
    );
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(closeFlow.pendingCloseRequest?.scope).toBe("close-window");
    expect(navigation.location).toBe("/editor/A");
    await act(async () => closeFlow.resolveCloseRequest(false));
    expect(destroyWindow).toHaveBeenCalledOnce();
  });
});
