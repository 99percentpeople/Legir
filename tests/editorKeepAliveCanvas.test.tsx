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
      openDocument: async () => {},
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
