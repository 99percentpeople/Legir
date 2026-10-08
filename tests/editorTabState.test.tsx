import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditorTabSnapshotFromState } from "@/app/editorTabs/storeSnapshot";
import {
  EditorRuntimeProvider,
  useEditorDocumentIdentityRuntime,
  useEditorPageTabsRuntime,
  type EditorDocumentRuntime,
  type EditorTabsRuntime,
} from "@/app/editorRuntime";
import { createAiChatSnapshotReader } from "@/hooks/useAiChatController/editorSnapshot";
import { selectAiChatEditorState } from "@/store/selectors";
import {
  useEditorView,
  activateEditorView,
  createDocumentEditorView,
} from "@/store/useEditorView";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { createTestEditorStore, field, page } from "./helpers/editorStore";

afterEach(() => {
  activateEditorView();
  useEditorView.setState(useEditorView.getInitialState(), true);
  vi.unstubAllGlobals();
});

describe("multi-document state boundaries", () => {
  it("round-trips same-sized PDF tabs without losing history, actions, scopes or global options", () => {
    const a = createTestEditorStore({
      filename: "A.pdf",
      fields: [field("A")],
      pages: [page(0), page(1)],
      currentPageIndex: 0,
    });
    a.getState().saveCheckpoint();
    a.getState().updateField("A", { value: "edited A" });
    const b = createTestEditorStore({
      filename: "B.pdf",
      fields: [field("B")],
      pages: [page(0), page(1)],
      currentPageIndex: 1,
      scale: 2,
    });
    const snapshotA = createEditorTabSnapshotFromState({
      state: a.getState(),
      scrollContainer: null,
    });
    const snapshotB = createEditorTabSnapshotFromState({
      state: b.getState(),
      scrollContainer: null,
    });
    useEditorView.getState().setOptions({ userName: "Global preference" });
    const options = useEditorView.getState().options;
    const importedA = createDocumentEditorView(snapshotA);
    const importedB = createDocumentEditorView(snapshotB);
    const listener = vi.fn();
    const unsubscribe = useEditorView.subscribe(
      (state) => state.currentPageIndex,
      listener,
    );
    try {
      activateEditorView(importedA.store);
      const readA = createAiChatSnapshotReader(
        () => selectAiChatEditorState(useEditorView.getState()),
        snapshotA.pdfBytes,
      );
      const previousTool = useEditorView.getState().beginTemporaryPan();
      activateEditorView(importedB.store);
      const stateB = useEditorView.getState();
      expect(stateB).toMatchObject({
        filename: "B.pdf",
        currentPageIndex: 1,
        scale: 2,
        keys: { space: false },
      });
      expect(stateB.fields[0].id).toBe("B");
      useEditorView.getState().endTemporaryPan(previousTool);
      expect(useEditorView.getState()).toBe(stateB);
      expect(readA).toThrow("no longer active");
      activateEditorView(importedA.store);
      expect(useEditorView.getState().pdfBytes).toBe(snapshotA.pdfBytes);
      expect(useEditorView.getState().fields[0].value).toBe("edited A");
      expect(useEditorView.getState().past).toHaveLength(1);
      expect(useEditorView.getState().dirtyPermissionScopes).toEqual(
        snapshotA.dirtyPermissionScopes,
      );
      expect(useEditorView.getState().options).toBe(options);
      expect(useEditorView.getState().openRightPanel).toBe(
        importedA.store.getState().openRightPanel,
      );
      useEditorView.getState().undo();
      expect(useEditorView.getState().fields[0].value).toBeUndefined();
      expect(listener.mock.calls).toEqual([
        [1, 0],
        [0, 1],
      ]);
    } finally {
      unsubscribe();
      activateEditorView();
      importedA.dispose();
      importedB.dispose();
    }
  });

  it("publishes sessionRenderKey and worker as one identity during activation", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const node = document.createElement("div");
    const root = createRoot(node);
    const workerA = { label: "A" } as unknown as PDFWorkerService;
    const workerB = { label: "B" } as unknown as PDFWorkerService;
    const seen: Array<[string | null, string | null, PDFWorkerService | null]> =
      [];
    const Probe = React.memo(function Probe() {
      const { activeTabId } = useEditorPageTabsRuntime();
      const { sessionRenderKey, workerService } =
        useEditorDocumentIdentityRuntime();
      seen.push([activeTabId, sessionRenderKey, workerService]);
      return null;
    });
    const noop = () => {};
    const asyncNoop = async () => {};
    const tabs: EditorTabsRuntime = {
      windowId: "window",
      tabs: [],
      activeTabId: "A",
      mergeWindowTargets: [],
      canDetachTabs: true,
      canMergeTabs: true,
      refreshMergeWindowTargets: asyncNoop,
      selectTab: noop,
      closeTab: noop,
      moveTab: noop,
      detachTab: asyncNoop,
      mergeTabToWindow: asyncNoop,
    };
    const runtime: EditorDocumentRuntime = {
      sessionRenderKey: "A",
      workerService: workerA,
      isFileDragActive: false,
      save: async () => true,
      saveAs: async () => true,
      exit: noop,
      print: noop,
      requestCloseCurrentTab: noop,
    };
    const child = <Probe />;
    try {
      await act(async () =>
        root.render(
          <EditorRuntimeProvider tabs={tabs} document={runtime}>
            {child}
          </EditorRuntimeProvider>,
        ),
      );
      await act(async () =>
        root.render(
          <EditorRuntimeProvider
            tabs={{ ...tabs, activeTabId: "B" }}
            document={{
              ...runtime,
              sessionRenderKey: "B",
              workerService: workerB,
            }}
          >
            {child}
          </EditorRuntimeProvider>,
        ),
      );
      await act(async () =>
        root.render(
          <EditorRuntimeProvider tabs={tabs} document={runtime}>
            {child}
          </EditorRuntimeProvider>,
        ),
      );
      expect(seen).toEqual([
        ["A", "A", workerA],
        ["B", "B", workerB],
        ["A", "A", workerA],
      ]);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
