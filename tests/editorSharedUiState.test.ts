import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateEditorView,
  windowEditorView,
  createDocumentEditorView,
  useEditorView,
} from "@/store/useEditorView";
import { createEditorTabSnapshotFromState } from "@/app/editorTabs/storeSnapshot";
import { createEditorTabRuntime } from "@/app/editorTabs/runtime";
import { createLocalSingleWindowTabBackend } from "@/app/editorTabs/backend";
import type { EditorTabSession } from "@/app/editorTabs/types";
import { createTestEditorStore, field, page } from "./helpers/editorStore";

const disposals: (() => void)[] = [];
const createDocument = (name: string) => {
  const document = createDocumentEditorView(
    createEditorTabSnapshotFromState({
      state: createTestEditorStore({
        filename: name,
        fields: [field(name)],
        pages: [page(0), page(1)],
        scale: 1,
      }).getState(),
      scrollContainer: null,
    }),
  );
  disposals.push(document.dispose);
  return document.store;
};

beforeEach(() => {
  activateEditorView();
  windowEditorView.setState(windowEditorView.getInitialState(), true);
  windowEditorView.setState({ isPanelFloating: false });
});

afterEach(() => {
  activateEditorView();
  disposals
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose());
  windowEditorView.setState(windowEditorView.getInitialState(), true);
});

describe("shared editor layout", () => {
  it("owns shared preferences and layout once without writing into document stores", () => {
    const a = createDocument("A.pdf");
    const b = createDocument("B.pdf");
    expect(a.workspace).toBe(b.workspace);
    expect(a.preferences).toBe(b.preferences);
    expect(a.document).not.toBe(b.document);
    expect(a.resources).not.toBe(b.resources);
    const aDocument = a.document.getState();
    const bDocument = b.document.getState();
    const changedA = vi.fn();
    const changedB = vi.fn();
    disposals.push(
      a.document.subscribe(changedA),
      b.document.subscribe(changedB),
    );
    a.getState().openSidebar("outline");
    a.getState().setOptions({ userName: "Shared user" });
    a.getState().updateToolStyle("penStyle", { color: "#123456" });
    expect(changedA).not.toHaveBeenCalled();
    expect(changedB).not.toHaveBeenCalled();
    expect(a.document.getState()).toBe(aDocument);
    expect(b.document.getState()).toBe(bDocument);
    expect(b.getState().options.userName).toBe("Shared user");
    expect(b.getState().penStyle.color).toBe("#123456");
    for (const key of [
      "options",
      "penStyle",
      "sidebarWidth",
      "isSidebarOpen",
      "thumbnailImages",
    ]) {
      expect(aDocument).not.toHaveProperty(key);
    }
    const snapshot = createEditorTabSnapshotFromState({
      state: aDocument,
      scrollContainer: null,
    });
    for (const key of [
      "options",
      "penStyle",
      "sidebarWidth",
      "isSidebarOpen",
      "thumbnailImages",
      "isProcessing",
      "keys",
    ]) {
      expect(snapshot).not.toHaveProperty(key);
    }
  });

  it("keeps document edits and resource updates out of UI persistence", () => {
    const a = createDocument("A.pdf");
    const write = vi.spyOn(Storage.prototype, "setItem");
    a.getState().updateField("A.pdf", { value: "edited" });
    a.getState().setScale(2);
    a.resources.setState({ thumbnailImages: { 0: "blob:page-a" } });
    expect(write).not.toHaveBeenCalled();
    expect(a.document.getState()).not.toHaveProperty("thumbnailImages");
    expect(a.getState().thumbnailImages[0]).toBe("blob:page-a");
    write.mockRestore();
  });

  it("keeps panel choices and sizes across existing, newly opened and reactivated tabs", () => {
    const a = createDocument("A.pdf");
    const b = createDocument("B.pdf");
    activateEditorView(a);
    a.getState().openSidebar("outline");
    a.getState().openRightPanel("ai_chat");
    a.getState().setUiState({ sidebarWidth: 300, rightPanelWidth: 420 });
    a.getState().setPageLayout("double_even");
    a.getState().setPageFlow("horizontal");
    const expected = {
      isSidebarOpen: true,
      sidebarTab: "outline",
      sidebarWidth: 300,
      isRightPanelOpen: true,
      rightPanelTab: "ai_chat",
      rightPanelWidth: 420,
      pageLayout: "double_even",
      pageFlow: "horizontal",
    };
    const c = createDocument("C.pdf");
    for (const store of [b, c, a]) {
      activateEditorView(store);
      expect(useEditorView.getState()).toMatchObject(expected);
    }
    expect(windowEditorView.getState()).toMatchObject(expected);
    expect(
      JSON.parse(localStorage.getItem("legir.workspace-layout")!).state.layout,
    ).toMatchObject({
      sidebar: { open: true, tab: "outline", width: 300 },
      rightPanel: { open: true, tab: "ai_chat", width: 420 },
      pageLayout: "double_even",
      pageFlow: "horizontal",
    });

    b.getState().closeSidebar();
    b.getState().closeRightPanel();
    for (const store of [a, b, c, windowEditorView]) {
      expect(store.getState()).toMatchObject({
        isSidebarOpen: false,
        isRightPanelOpen: false,
        sidebarTab: "outline",
        rightPanelTab: "ai_chat",
      });
    }
  });

  it("keeps reading position, selection, edits and undo history local", () => {
    const a = createDocument("A.pdf");
    const b = createDocument("B.pdf");
    a.getState().setScale(2);
    a.setState({ currentPageIndex: 1 });
    a.getState().selectControl("A.pdf");
    a.getState().saveCheckpoint();
    a.getState().updateField("A.pdf", { value: "edited" });
    a.getState().openSidebar("fields");
    expect(b.getState()).toMatchObject({
      filename: "B.pdf",
      scale: 1,
      currentPageIndex: 0,
      selectedId: null,
      fields: [field("B.pdf")],
      past: [],
    });
    expect(a.getState().past).toHaveLength(1);
    a.getState().undo();
    expect(a.getState().sidebarTab).toBe("fields");
    expect(b.getState().sidebarTab).toBe("fields");
  });

  it("preserves the latest layout when an old snapshot is hydrated or restored", () => {
    const snapshot = createEditorTabSnapshotFromState({
      state: createTestEditorStore({
        filename: "Old.pdf",
        documentLoadState: "error",
      }).getState(),
      scrollContainer: null,
    });
    const runtime = createEditorTabRuntime(snapshot, {});
    disposals.push(runtime.dispose);
    const backend = createLocalSingleWindowTabBackend();
    disposals.push(() => backend.dispose());
    backend.addSession("w", {
      id: "tab",
      windowId: "w",
      sourceKey: null,
      lastActiveAt: "",
      runtime,
      workerService: { destroy: vi.fn() },
      disposePdfResources: null,
    } as unknown as EditorTabSession);
    windowEditorView.getState().openSidebar("annotations");
    windowEditorView.getState().openRightPanel("ai_chat");
    windowEditorView.getState().setUiState({ sidebarWidth: 310 });
    backend.updateSession("tab", {
      document: { ...snapshot, filename: "Hydrated.pdf" },
    });
    const expected = {
      isSidebarOpen: true,
      sidebarTab: "annotations",
      sidebarWidth: 310,
      isRightPanelOpen: true,
      rightPanelTab: "ai_chat",
    };
    expect(runtime.store.getState()).toMatchObject({
      ...expected,
      filename: "Hydrated.pdf",
    });
    activateEditorView(runtime.store);
    const imported = createDocumentEditorView(snapshot);
    disposals.push(imported.dispose);
    activateEditorView(imported.store);
    expect(imported.store.getState()).toMatchObject({
      ...expected,
      filename: "Old.pdf",
    });
    expect(windowEditorView.getState()).toMatchObject(expected);
  });

  it("shares floating-panel exclusivity and retains layout after the last document closes", () => {
    const a = createDocument("A.pdf");
    const b = createDocument("B.pdf");
    a.getState().openSidebar("outline");
    a.getState().setPanelFloating(true);
    b.getState().openRightPanel("ai_chat");
    const expected = {
      isPanelFloating: true,
      isSidebarOpen: false,
      isRightPanelOpen: true,
      rightPanelTab: "ai_chat",
    };
    expect(a.getState()).toMatchObject(expected);
    windowEditorView.getState().resetDocument();
    expect(createDocument("New.pdf").getState()).toMatchObject(expected);
  });
});
