import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEditorTabSnapshotFromState,
  restoreEditorTabSnapshot,
} from "@/app/editorTabs/storeSnapshot";
import {
  EditorRuntimeProvider,
  useEditorDocumentIdentityRuntime,
  useEditorPageTabsRuntime,
  type EditorDocumentRuntime,
  type EditorTabsRuntime,
} from "@/app/editorRuntime";
import { createAiChatSnapshotReader } from "@/hooks/useAiChatController/editorSnapshot";
import { selectAiChatEditorState } from "@/store/selectors";
import { useEditorStore } from "@/store/useEditorStore";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { createTestEditorStore, field, page } from "./helpers/editorStore";

afterEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
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
    const warmup = vi.fn();
    useEditorStore.setState(
      { ...useEditorStore.getInitialState(), warmupThumbnails: warmup },
      true,
    );
    useEditorStore.getState().setOptions({ userName: "Global preference" });
    const options = useEditorStore.getState().options;
    const action = useEditorStore.getState().openRightPanel;
    const listener = vi.fn();
    const unsubscribe = useEditorStore.subscribe(
      (state) => state.currentPageIndex,
      listener,
    );
    try {
      restoreEditorTabSnapshot(snapshotA);
      const readA = createAiChatSnapshotReader(
        () => selectAiChatEditorState(useEditorStore.getState()),
        snapshotA.pdfBytes,
      );
      const previousTool = useEditorStore.getState().beginTemporaryPan();
      restoreEditorTabSnapshot(snapshotB);
      const stateB = useEditorStore.getState();
      expect(stateB).toMatchObject({
        filename: "B.pdf",
        currentPageIndex: 1,
        scale: 2,
        keys: { space: false },
      });
      expect(stateB.fields[0].id).toBe("B");
      useEditorStore.getState().endTemporaryPan(previousTool);
      expect(useEditorStore.getState()).toBe(stateB);
      expect(readA).toThrow("no longer active");
      restoreEditorTabSnapshot(snapshotA);
      expect(useEditorStore.getState().pdfBytes).toBe(snapshotA.pdfBytes);
      expect(useEditorStore.getState().fields[0].value).toBe("edited A");
      expect(useEditorStore.getState().past).toHaveLength(1);
      expect(useEditorStore.getState().dirtyPermissionScopes).toEqual(
        snapshotA.dirtyPermissionScopes,
      );
      expect(useEditorStore.getState().options).toBe(options);
      expect(useEditorStore.getState().openRightPanel).toBe(action);
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().fields[0].value).toBeUndefined();
      expect(listener.mock.calls).toEqual([
        [1, 0],
        [0, 1],
      ]);
    } finally {
      unsubscribe();
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
      openDocument: asyncNoop,
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
