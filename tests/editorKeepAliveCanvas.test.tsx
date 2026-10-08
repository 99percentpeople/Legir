import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EditorRuntimeProvider,
  useEditorDocumentIdentityRuntime,
  type EditorTabsRuntime,
} from "@/app/editorRuntime";
import { createEditorTabSnapshotFromState } from "@/app/editorTabs/storeSnapshot";
import { createEditorTabRuntime } from "@/app/editorTabs/runtime";
import { disposeEditorTabSessionResources } from "@/app/editorTabs/sessionResources";
import { useEditorView } from "@/store/useEditorView";
import type { EditorTabSession } from "@/app/editorTabs/types";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { createTestEditorStore, page } from "./helpers/editorStore";
import KeepAliveEditor from "@/pages/EditorPage/KeepAliveEditor";
import PDFCanvasLayer from "@/components/workspace/layers/PDFCanvasLayer";

vi.mock("@/pages/EditorPage/components/EditorTabStrip", () => ({
  EditorTabStrip: () => null,
}));
vi.mock("@/components/workspace/layers/PDFTileLayer", () => ({
  default: () => null,
}));
vi.mock("@/pages/EditorPage/index", () => ({
  default: function CanvasProbe() {
    const { workerService, sessionRenderKey } =
      useEditorDocumentIdentityRuntime();
    const currentPage = useEditorView((state) => state.pages[0]);
    return (
      <PDFCanvasLayer
        workerService={workerService}
        sessionRenderKey={sessionRenderKey}
        page={currentPage}
        scale={1}
        isInView
      />
    );
  },
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("retained PDF canvas", () => {
  it.each([false, true])(
    "keeps document hosts and canvas lifecycles stable across reordering (StrictMode=%s)",
    async (strictMode) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
        setTimeout(() => callback(performance.now()), 0),
      );
      vi.stubGlobal("cancelAnimationFrame", clearTimeout);
      const transfer = vi.fn(() => ({}));
      Object.defineProperty(
        HTMLCanvasElement.prototype,
        "transferControlToOffscreen",
        {
          configurable: true,
          value: transfer,
        },
      );
      const created: EditorTabSession[] = [];
      const create = (id: string) => {
        const seed = createTestEditorStore({ filename: id, pages: [page()] });
        const snapshot = createEditorTabSnapshotFromState({
          state: seed.getState(),
          scrollContainer: null,
        });
        seed.dispose();
        const worker = {
          renderPage: vi.fn(async () => true),
          releaseCanvas: vi.fn(async () => {}),
          destroy: vi.fn(),
        };
        const session: EditorTabSession = {
          id,
          windowId: "w",
          sourceKey: null,
          lastActiveAt: "",
          runtime: createEditorTabRuntime(snapshot, {
            0: "data:image/png;base64,placeholder",
          }),
          workerService: worker as unknown as PDFWorkerService,
          disposePdfResources: null,
        };
        created.push(session);
        return { session, worker };
      };
      const b = create("B");
      const c = create("C");
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      const noop = () => {};
      const save = async () => true;
      const render = async (
        activeTabId: string | null,
        sessions: EditorTabSession[],
      ) => {
        const view = (
          <EditorRuntimeProvider
            tabs={{
              sessions,
              tabs: [],
              windowId: "w",
              activeTabId,
              mergeWindowTargets: [],
              canDetachTabs: false,
              canMergeTabs: false,
              refreshMergeWindowTargets: async () => {},
              selectTab: noop,
              closeTab: noop,
              moveTab: noop,
              detachTab: async () => {},
              mergeTabToWindow: async () => {},
            }}
            document={{
              sessionRenderKey: activeTabId,
              workerService: b.session.workerService,
              isFileDragActive: false,
              save,
              saveAs: save,
              exit: noop,
              print: noop,
              requestCloseCurrentTab: noop,
            }}
          >
            <KeepAliveEditor />
          </EditorRuntimeProvider>
        );
        await act(async () =>
          root.render(
            strictMode ? <React.StrictMode>{view}</React.StrictMode> : view,
          ),
        );
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
        });
      };
      const hosts = () =>
        Array.from(host.querySelectorAll<HTMLElement>("[data-editor-tab]"));
      const mutations: MutationRecord[] = [];
      const observer = new MutationObserver((records) =>
        mutations.push(...records),
      );
      try {
        await render("B", [b.session, c.session]);
        const originalHosts = hosts();
        const originalCanvases = Array.from(host.querySelectorAll("canvas"));
        originalHosts[0].scrollTop = 2400;
        originalHosts[1].scrollTop = 1200;
        observer.observe(originalHosts[0].parentElement!, { childList: true });
        // StrictMode may replay effects on initial mount. Only subsequent
        // sorting must leave these already-live canvas resources untouched.
        transfer.mockClear();
        for (const { worker } of [b, c]) {
          worker.renderPage.mockClear();
          worker.releaseCanvas.mockClear();
        }
        const reversed = [c.session, b.session];
        await render("B", reversed);
        await render("C", [b.session, c.session]);
        await render(null, reversed);
        expect(reversed).toEqual([c.session, b.session]);
        expect(hosts()).toEqual(originalHosts);
        expect(Array.from(host.querySelectorAll("canvas"))).toEqual(
          originalCanvases,
        );
        expect(mutations).toHaveLength(0);
        expect(originalHosts.map((node) => node.scrollTop)).toEqual([
          2400, 1200,
        ]);
        expect(transfer).not.toHaveBeenCalled();
        for (const { worker } of [b, c]) {
          expect(worker.renderPage).not.toHaveBeenCalled();
          expect(worker.releaseCanvas).not.toHaveBeenCalled();
          expect(worker.destroy).not.toHaveBeenCalled();
        }

        // New IDs can sort before existing hosts (for example an incoming
        // transfer); inserting one must not move the retained documents.
        const a = create("A");
        await render("B", [c.session, a.session, b.session]);
        expect(
          hosts().filter((node) => node.dataset.editorTab !== "A"),
        ).toEqual(originalHosts);
        expect(
          mutations.flatMap((record) => Array.from(record.removedNodes)),
        ).toHaveLength(0);
        const allHosts = hosts();
        mutations.length = 0;
        await render("B", [b.session, c.session, a.session]);
        expect(hosts()).toEqual(allHosts);
        expect(mutations).toHaveLength(0);
        for (const { worker } of [b, c]) {
          expect(worker.renderPage).not.toHaveBeenCalled();
          expect(worker.releaseCanvas).not.toHaveBeenCalled();
        }

        await render("B", [b.session, a.session]);
        expect(c.worker.releaseCanvas).toHaveBeenCalledOnce();
        expect(b.worker.releaseCanvas).not.toHaveBeenCalled();
        expect(hosts()).toEqual(
          allHosts.filter((node) => node.dataset.editorTab !== "C"),
        );
        mutations.length = 0;
        await render("B", [
          a.session,
          { ...b.session, lastActiveAt: "updated" },
        ]);
        expect(mutations).toHaveLength(0);
        expect(b.worker.renderPage).not.toHaveBeenCalled();
        expect(b.worker.releaseCanvas).not.toHaveBeenCalled();
        expect(originalHosts[0].scrollTop).toBe(2400);
      } finally {
        observer.disconnect();
        await act(async () => root.unmount());
        host.remove();
        created.forEach(disposeEditorTabSessionResources);
        delete (
          HTMLCanvasElement.prototype as unknown as Record<string, unknown>
        ).transferControlToOffscreen;
      }
    },
  );

  it("does not transfer or rasterize again on A/B/A and releases canvases only on removal", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    const transfer = vi.fn(() => ({}));
    Object.defineProperty(
      HTMLCanvasElement.prototype,
      "transferControlToOffscreen",
      { configurable: true, value: transfer },
    );
    const create = (id: string) => {
      const snapshot = createEditorTabSnapshotFromState({
        state: createTestEditorStore({
          filename: id,
          pages: [page()],
        }).getState(),
        scrollContainer: null,
      });
      const worker = {
        renderPage: vi.fn(async () => true),
        releaseCanvas: vi.fn(async () => {}),
        destroy: vi.fn(),
      };
      const runtime = createEditorTabRuntime(snapshot, {
        0: "data:image/png;base64,placeholder",
      });
      return {
        session: {
          id,
          windowId: "w",
          sourceKey: null,
          lastActiveAt: "",
          runtime,
          workerService: worker as unknown as PDFWorkerService,
          disposePdfResources: null,
        } satisfies EditorTabSession,
        worker,
      };
    };
    const a = create("A"),
      b = create("B");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const noop = () => {};
    const tabs: EditorTabsRuntime = {
      windowId: "w",
      tabs: [],
      activeTabId: "A",
      mergeWindowTargets: [],
      canDetachTabs: false,
      canMergeTabs: false,
      refreshMergeWindowTargets: async () => {},
      selectTab: noop,
      closeTab: noop,
      moveTab: noop,
      detachTab: async () => {},
      mergeTabToWindow: async () => {},
    };
    const render = async (id: string, sessions = [a.session, b.session]) => {
      await act(async () =>
        root.render(
          <EditorRuntimeProvider
            tabs={{ ...tabs, sessions, activeTabId: id }}
            document={{
              sessionRenderKey: id,
              workerService: a.session.workerService,
              isFileDragActive: false,
              save: async () => true,
              saveAs: async () => true,
              exit: noop,
              print: noop,
              requestCloseCurrentTab: noop,
            }}
          >
            <KeepAliveEditor />
          </EditorRuntimeProvider>,
        ),
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
    };
    try {
      await render("A");
      const original = Array.from(host.querySelectorAll("canvas"));
      expect(a.worker.renderPage).toHaveBeenCalledTimes(1);
      expect(b.worker.renderPage).toHaveBeenCalledTimes(1);
      await render("B");
      await render("A");
      expect(Array.from(host.querySelectorAll("canvas"))).toEqual(original);
      expect(transfer).toHaveBeenCalledTimes(2);
      expect(a.worker.renderPage).toHaveBeenCalledTimes(1);
      expect(b.worker.renderPage).toHaveBeenCalledTimes(1);
      expect(a.worker.releaseCanvas).not.toHaveBeenCalled();
      expect(b.worker.releaseCanvas).not.toHaveBeenCalled();
      await render("A", [a.session]);
      expect(b.worker.releaseCanvas).toHaveBeenCalledOnce();
      expect(a.worker.releaseCanvas).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
      disposeEditorTabSessionResources(a.session);
      disposeEditorTabSessionResources(b.session);
      delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>)
        .transferControlToOffscreen;
    }
  });
});
