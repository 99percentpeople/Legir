import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EditorRuntimeProvider,
  type EditorTabsRuntime,
} from "@/app/editorRuntime";
import {
  createEditorTabSnapshotFromState,
  getEditorTabSnapshot,
  getEditorTabTitle,
} from "@/app/editorTabs/storeSnapshot";
import {
  createEditorTabRuntime,
  deactivateEditorTabRuntime,
} from "@/app/editorTabs/runtime";
import { disposeEditorTabSessionResources } from "@/app/editorTabs/sessionResources";
import { commitDocumentSaveState } from "@/app/editorTabs/saveState";
import {
  activateEditorView,
  getActiveEditorView,
  useEditorView,
} from "@/store/useEditorView";
import { useEventListener } from "@/hooks/useEventListener";
import type { EditorTabSession } from "@/app/editorTabs/types";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { createTestEditorStore, field, page } from "./helpers/editorStore";
import KeepAliveEditor from "@/pages/EditorPage/KeepAliveEditor";
import { useEditorTabsController } from "@/app/editorTabs/useEditorTabsController";

const probes = vi.hoisted(() => ({ mounts: vi.fn(), unmounts: vi.fn() }));
vi.mock("@/pages/EditorPage/components/EditorTabStrip", () => ({
  EditorTabStrip: () => null,
}));
vi.mock("@/pages/EditorPage/index", () => ({
  default: function PageProbe() {
    const state = useEditorView();
    const [draft, setDraft] = React.useState(0);
    React.useEffect(() => {
      probes.mounts(state.filename);
      return () => probes.unmounts(state.filename);
    }, []);
    useEventListener(window, "keydown", () => setDraft((value) => value + 1));
    return (
      <div>
        <canvas data-filename={state.filename} />
        <span>
          {state.filename}:{draft}:{state.scale}
        </span>
      </div>
    );
  },
}));

const sessions: EditorTabSession[] = [];
function session(id: string): EditorTabSession {
  const snapshot = createEditorTabSnapshotFromState({
    state: createTestEditorStore({
      filename: `${id}.pdf`,
      fields: [field(id)],
      pages: [page(0)],
    }).getState(),
    scrollContainer: null,
  });
  const runtime = createEditorTabRuntime(snapshot, {});
  const result = {
    id,
    windowId: "w",
    sourceKey: null,
    lastActiveAt: "",
    runtime,
    workerService: { destroy: vi.fn() } as unknown as PDFWorkerService,
    disposePdfResources: vi.fn(),
  };
  sessions.push(result);
  return result;
}
afterEach(() => {
  activateEditorView();
  sessions.splice(0).forEach(disposeEditorTabSessionResources);
  probes.mounts.mockClear();
  probes.unmounts.mockClear();
  vi.unstubAllGlobals();
});

describe("live document tabs", () => {
  it("isolates state/history and commits an asynchronous save only to its document/revision", () => {
    const a = session("A").runtime!.store;
    const b = session("B").runtime!.store;
    a.getState().saveCheckpoint();
    a.getState().updateField("A", { value: "saved revision" });
    const saved = a.getState();
    activateEditorView(a);
    a.getState().updateField("A", { value: "new edit during save" });
    activateEditorView(b);
    commitDocumentSaveState(
      a,
      saved,
      { kind: "tauri", path: "/A.pdf" },
      "A.pdf",
    );
    expect(b.getState().filename).toBe("B.pdf");
    expect(b.getState().saveTarget).toBeNull();
    expect(a.getState().isDirty).toBe(true);
    expect(a.getState().fields[0].value).toBe("new edit during save");
    activateEditorView(a);
    expect(useEditorView.getState()).toBe(a.getState());
    expect(a.getState().past).toHaveLength(1);
    a.getState().undo();
    expect(b.getState().fields[0].id).toBe("B");
  });

  it("keeps DOM, local state and stores mounted and routes keyboard input only to the visible tab", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const a = session("A"),
      b = session("B");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const noop = () => {};
    const tabs: EditorTabsRuntime = {
      sessions: [a, b],
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
    const render = async (id: string, currentSessions = [a, b]) =>
      act(async () =>
        root.render(
          <EditorRuntimeProvider
            tabs={{ ...tabs, activeTabId: id, sessions: currentSessions }}
            document={{
              sessionRenderKey: id,
              workerService: a.workerService,
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
    try {
      await render("A");
      const canvasA = host.querySelector('[data-filename="A.pdf"]');
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
        a.runtime!.store.setState({ scale: 2 });
      });
      await render("B");
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
      });
      await render("A");
      expect(probes.mounts).toHaveBeenCalledTimes(2);
      expect(probes.unmounts).not.toHaveBeenCalled();
      expect(host.querySelector('[data-filename="A.pdf"]')).toBe(canvasA);
      expect(a.runtime!.root?.textContent).toBe("A.pdf:1:2");
      expect(b.runtime!.root?.textContent).toContain("B.pdf:1:");
      await render("A", [a]);
      expect(probes.unmounts).toHaveBeenCalledWith("B.pdf");
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("does not replay a live snapshot when synchronizing active-tab metadata", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let tabs!: ReturnType<typeof useEditorTabsController>;
    const seed = session("seed");
    const capture = () => ({
      snapshot: getEditorTabSnapshot(seed),
    });
    const restore = (tab: EditorTabSession) =>
      activateEditorView(tab.runtime!.store);
    function ControllerProbe() {
      tabs = useEditorTabsController({
        persistDocumentView: capture,
        activateSession: restore,
      });
      return null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => root.render(<ControllerProbe />));
      await act(async () => {
        tabs.addTab({
          id: "live",
          title: "live",
          sourceKey: null,
          snapshot: getEditorTabSnapshot(seed),
          workerService: { destroy: vi.fn() } as unknown as PDFWorkerService,
          activate: true,
        });
      });
      const store = tabs.getTabById("live")!.runtime!.store;
      const revision = store.getState();
      await act(async () =>
        tabs.backend.updateSession("live", { sourceKey: "live" }),
      );
      expect(store.getState()).toBe(revision);
      expect(store.getState().pendingViewStateRestore).toBe(
        revision.pendingViewStateRestore,
      );
    } finally {
      await act(async () => {
        tabs.disposeAllTabs();
        root.unmount();
      });
    }
  });

  it("uses private workspace events and independent processing tasks", async () => {
    const a = session("A").runtime!,
      b = session("B").runtime!;
    const onA = vi.fn(),
      onB = vi.fn();
    a.events.on("workspace:navigatePage", onA);
    b.events.on("workspace:navigatePage", onB);
    a.events.emit("workspace:navigatePage", { pageIndex: 1 });
    expect(onA).toHaveBeenCalledOnce();
    expect(onB).not.toHaveBeenCalled();
    let finish!: () => void;
    const pending = a.store.getState().withProcessing(
      "saving A",
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await b.store.getState().withProcessing("saving B", async () => {});
    expect(a.store.getState().isProcessing).toBe(true);
    expect(b.store.getState().isProcessing).toBe(false);
    finish();
    await pending;
    expect(a.store.getState().isProcessing).toBe(false);
  });

  it.each([false, true])(
    "preserves and reactivates the last tab after transfer rollback (wait for render: %s)",
    async (waitForRender) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      let tabs!: ReturnType<typeof useEditorTabsController>;
      const extractedRef: { current: EditorTabSession | null } = {
        current: null,
      };
      const seed = session("transfer");
      const restore = vi.fn((tab: EditorTabSession) => {
        tab.runtime!.active = true;
        activateEditorView(tab.runtime!.store);
      });
      const capture = () => ({
        snapshot: createEditorTabSnapshotFromState({
          state: useEditorView.getState(),
          scrollContainer: null,
        }),
      });
      function ControllerProbe() {
        tabs = useEditorTabsController({
          windowId: "w",
          persistDocumentView: capture,
          activateSession: restore,
        });
        return null;
      }
      const root = createRoot(document.createElement("div"));
      try {
        await act(async () => root.render(<ControllerProbe />));
        await act(async () => {
          tabs.addTab({
            id: "transfer",
            title: getEditorTabTitle(seed),
            sourceKey: null,
            snapshot: getEditorTabSnapshot(seed),
            workerService: seed.workerService,
            activate: true,
          });
        });
        const runtime = tabs.getTabById("transfer")!.runtime!;
        const store = runtime.store;
        await act(async () => {
          store.getState().saveCheckpoint();
          store.getState().updateField("transfer", { value: "unsaved edit" });
        });
        const revision = store.getState();
        const remove = () => {
          extractedRef.current = tabs.backend.removeSession("w", "transfer")!;
          deactivateEditorTabRuntime(runtime);
          expect(getActiveEditorView()).not.toBe(store);
          expect(useEditorView.getState().pdfBytes).toBeNull();
          expect(runtime.active).toBe(false);
          expect(runtime.signal.aborted).toBe(false);
        };
        const rollback = () => {
          tabs.backend.addSession("w", extractedRef.current!, {
            targetIndex: 0,
          });
          tabs.activateTab("transfer", { skipCaptureCurrent: true });
        };
        if (waitForRender) {
          await act(async () => remove());
          await act(async () => rollback());
        } else {
          await act(async () => {
            remove();
            rollback();
          });
        }

        expect(getActiveEditorView()).toBe(store);
        expect(runtime.active).toBe(true);
        expect(store.getState().pdfBytes).toBe(revision.pdfBytes);
        expect(store.getState().fields).toBe(revision.fields);
        expect(store.getState().fields[0].value).toBe("unsaved edit");
        expect(store.getState().isDirty).toBe(true);
        expect(store.getState().past).toBe(revision.past);
        expect(seed.workerService.destroy).not.toHaveBeenCalled();
        expect(restore).toHaveBeenCalledTimes(2);
        await act(async () => store.getState().undo());
        expect(store.getState().fields[0].value).toBeUndefined();
      } finally {
        await act(async () => {
          tabs.disposeAllTabs();
          root.unmount();
        });
        extractedRef.current?.runtime?.dispose();
      }
    },
  );
});
