import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { UNRESTRICTED_PDF_PERMISSIONS } from "@/lib/pdfPermissions";
import { ANNOTATION_STYLES } from "@/constants";
import { FieldType } from "@/types";
import { createAiChatSnapshotReader } from "@/hooks/useAiChatController/editorSnapshot";
import {
  selectAiChatEditorState,
  selectAiChatReactiveState,
  selectPropertiesRightPanelState,
  selectRightPanelShellState,
} from "@/store/selectors";
import { shallow } from "zustand/shallow";
import { candidate, createTestEditorStore, field } from "./helpers/editorStore";

describe("panel domain actions", () => {
  it("opens floating panels atomically and keeps only the requested side open", () => {
    const store = createTestEditorStore({ isPanelFloating: true });
    const observed: boolean[] = [];
    store.subscribe((s) =>
      observed.push(s.isSidebarOpen && s.isRightPanelOpen),
    );
    store.getState().openRightPanel("ai_chat");
    expect(store.getState()).toMatchObject({
      isRightPanelOpen: true,
      isSidebarOpen: false,
      rightPanelTab: "ai_chat",
    });
    store.getState().openSidebar("annotations");
    expect(store.getState()).toMatchObject({
      isRightPanelOpen: false,
      isSidebarOpen: true,
      sidebarTab: "annotations",
    });
    store.getState().toggleRightPanel();
    store.getState().toggleSidebar();
    store.getState().closeFloatingPanels();
    expect(store.getState()).toMatchObject({
      isRightPanelOpen: false,
      isSidebarOpen: false,
    });
    expect(observed.every((invalid) => !invalid)).toBe(true);
  });

  it("allows both docked panels and normalizes the desktop/mobile transition", () => {
    const store = createTestEditorStore();
    store.getState().openSidebar();
    store.getState().openRightPanel("document");
    store.getState().closeFloatingPanels();
    expect(store.getState()).toMatchObject({
      isRightPanelOpen: true,
      isSidebarOpen: true,
    });
    store.getState().setPanelFloating(true);
    expect(store.getState()).toMatchObject({
      isPanelFloating: true,
      isRightPanelOpen: false,
      isSidebarOpen: true,
    });
    store.getState().setPanelFloating(false);
    store.getState().openRightPanel();
    expect(store.getState()).toMatchObject({
      isRightPanelOpen: true,
      isSidebarOpen: true,
    });
  });

  it("requires a real selected control for properties, including restored stale IDs", () => {
    const store = createTestEditorStore({ selectedId: "missing" });
    const original = store.getState();
    store.getState().openRightPanel("properties");
    expect(store.getState()).toBe(original);
    store.setState({ fields: [field()], selectedId: "field-1" });
    store.getState().openRightPanel("properties");
    expect(store.getState().rightPanelTab).toBe("properties");
    store.setState({ selectedId: null });
    store.getState().syncPanelSelection("field-1");
    expect(store.getState().rightPanelTab).toBe("document");
    store.setState({ rightPanelTab: "properties" });
    store.getState().openRightPanel();
    expect(store.getState().rightPanelTab).toBe("document");
  });

  it("applies selection-driven tab policy without changing panel visibility", () => {
    const store = createTestEditorStore({
      fields: [field()],
      selectedId: "field-1",
    });
    store.getState().syncPanelSelection(null);
    expect(store.getState()).toMatchObject({
      rightPanelTab: "properties",
      isRightPanelOpen: false,
    });
    store.getState().openRightPanel("ai_chat");
    const current = store.getState();
    store.getState().syncPanelSelection("field-1");
    expect(store.getState()).toBe(current);
  });

  it.each(["canCopy", "canModifyAnnotations"] as const)(
    "guards translation when %s is denied",
    (permission) => {
      const store = createTestEditorStore({
        documentPermissions: {
          ...UNRESTRICTED_PDF_PERMISSIONS,
          [permission]: false,
        },
      });
      const original = store.getState();
      store.getState().openRightPanel("page_translate");
      expect(store.getState()).toBe(original);
    },
  );

  it("avoids notifications for repeated open/close/floating/resize and leaves history untouched", () => {
    const store = createTestEditorStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const original = store.getState();
    store.getState().closeSidebar();
    store.getState().closeRightPanel();
    store.getState().setPanelFloating(false);
    store.getState().setUiState({ rightPanelWidth: original.rightPanelWidth });
    expect(store.getState()).toBe(original);
    expect(listener).not.toHaveBeenCalled();
    store.getState().openSidebar();
    const opened = store.getState();
    store.getState().openSidebar();
    expect(store.getState()).toBe(opened);
    expect(store.getState().past).toBe(original.past);
    expect(store.getState().dirtyPermissionScopes).toBe(
      original.dirtyPermissionScopes,
    );
    expect(store.getState().isDirty).toBe(false);
  });
});

describe("tool styles and temporary pan", () => {
  it.each([
    "penStyle",
    "highlightStyle",
    "commentStyle",
    "freetextStyle",
    "shapeStyle",
  ] as const)("merges %s without changing document state", (kind) => {
    const store = createTestEditorStore();
    const before = store.getState();
    const oldStyle = before[kind];
    store.getState().updateToolStyle(kind, { color: "#123456" });
    expect(store.getState()[kind]).toMatchObject({
      ...oldStyle,
      color: "#123456",
    });
    expect(oldStyle?.color).not.toBe("#123456");
    expect(store.getState().past).toBe(before.past);
    expect(store.getState().dirtyPermissionScopes).toBe(
      before.dirtyPermissionScopes,
    );
    expect(store.getState().isDirty).toBe(false);
    const after = store.getState();
    store.getState().updateToolStyle(kind, { color: "#123456" });
    expect(store.getState()).toBe(after);
  });

  it("fills optional style defaults and patches stamp properties independently", () => {
    const store = createTestEditorStore({ shapeStyle: undefined });
    store.getState().updateToolStyle("shapeStyle", { opacity: 0.25 });
    expect(store.getState().shapeStyle).toEqual({
      ...ANNOTATION_STYLES.shape,
      opacity: 0.25,
    });
    const stamp = store.getState().stampStyle;
    store.getState().updateToolStyle("stampStyle", { opacity: 0.5 });
    expect(store.getState().stampStyle).toEqual({ ...stamp, opacity: 0.5 });
    const after = store.getState();
    store.getState().updateToolStyle("stampStyle", {});
    expect(store.getState()).toBe(after);
  });

  it("temporarily pans and restores atomically without clearing selection", () => {
    const store = createTestEditorStore({
      fields: [field()],
      selectedId: "field-1",
      mode: "form",
      tool: "draw_text",
    });
    const listener = vi.fn();
    store.subscribe(listener);
    const previous = store.getState().beginTemporaryPan();
    expect(previous).toBe("draw_text");
    expect(store.getState()).toMatchObject({
      tool: "pan",
      keys: { space: true },
      selectedId: "field-1",
    });
    expect(listener).toHaveBeenCalledTimes(1);
    const panState = store.getState();
    store.getState().beginTemporaryPan();
    expect(store.getState()).toBe(panState);
    store.getState().endTemporaryPan(previous);
    expect(store.getState()).toMatchObject({
      tool: "draw_text",
      keys: { space: false },
      selectedId: "field-1",
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("rechecks permissions on restoration and does not overwrite an explicitly changed tool", () => {
    const store = createTestEditorStore({ mode: "form", tool: "draw_text" });
    const previous = store.getState().beginTemporaryPan();
    store.setState({
      documentPermissions: {
        ...UNRESTRICTED_PDF_PERMISSIONS,
        canModifyContents: false,
      },
    });
    store.getState().endTemporaryPan(previous);
    expect(store.getState().tool).toBe("select");
    store.getState().beginTemporaryPan();
    store.getState().setTool("select_text");
    store.getState().endTemporaryPan("draw_text");
    expect(store.getState().tool).toBe("select_text");
  });

  it("does not restore a stale tool after tab restoration has reset transient keys", () => {
    const store = createTestEditorStore({ mode: "form", tool: "draw_text" });
    const previous = store.getState().beginTemporaryPan();
    store.setState({
      tool: "select_text",
      keys: { ...store.getState().keys, space: false },
    });
    const restored = store.getState();
    store.getState().endTemporaryPan(previous);
    expect(store.getState()).toBe(restored);
  });
});

describe("selective subscriptions and truthful AI snapshots", () => {
  it("calls the viewport listener only for page changes and supports unsubscribe", () => {
    const store = createTestEditorStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe((s) => s.currentPageIndex, listener, {
      fireImmediately: true,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    store.getState().zoomBy(1.25);
    store.getState().setUiState({ rightPanelWidth: 450 });
    store.getState().addAnnotation({ id: "a", type: "comment", pageIndex: 0 });
    expect(listener).toHaveBeenCalledTimes(1);
    store.setState({ currentPageIndex: 1 });
    expect(listener).toHaveBeenLastCalledWith(1, 0);
    store.setState({ currentPageIndex: 1 });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.setState({ currentPageIndex: 2 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("reads live scale/metadata/layout without changing the AI reactive selection", () => {
    const store = createTestEditorStore();
    const before = selectAiChatReactiveState(store.getState());
    const read = createAiChatSnapshotReader(
      () => selectAiChatEditorState(store.getState()),
      store.getState().pdfBytes,
    );
    for (let i = 0; i < 20; i++) {
      store.getState().setScale(1 + i * 0.1);
      expect(read().scale).toBe(store.getState().scale);
    }
    store.setState({
      metadata: { title: "Updated" },
      pageLayout: "double_odd",
      currentPageIndex: 2,
    });
    expect(read()).toMatchObject({
      metadata: { title: "Updated" },
      pageLayout: "double_odd",
      currentPageIndex: 2,
    });
    expect(shallow(before, selectAiChatReactiveState(store.getState()))).toBe(
      true,
    );
    store.setState({ pdfBytes: new Uint8Array([2]) });
    expect(read).toThrow("no longer active");
  });

  it("isolates the shell and selected control from unrelated fields and metadata", () => {
    const store = createTestEditorStore({
      fields: [field("selected"), field("other")],
      selectedId: "selected",
    });
    const shell = selectRightPanelShellState(store.getState());
    const properties = selectPropertiesRightPanelState(store.getState());
    store.getState().updateField("other", { value: "changed" });
    expect(shallow(shell, selectRightPanelShellState(store.getState()))).toBe(
      true,
    );
    expect(
      shallow(properties, selectPropertiesRightPanelState(store.getState())),
    ).toBe(true);
    store.setState({ metadata: { title: "Changed" } });
    expect(shallow(shell, selectRightPanelShellState(store.getState()))).toBe(
      true,
    );
    store.getState().updateField("selected", { value: "selected changed" });
    expect(
      selectPropertiesRightPanelState(store.getState()).selectedControl,
    ).not.toBe(properties.selectedControl);
  });
});

describe("shallow-merge behavior", () => {
  it("preserves radio synchronization, immutable history and permission dirty scopes through undo/redo", () => {
    const store = createTestEditorStore({
      fields: [
        field("a", { name: "group", type: FieldType.RADIO, isChecked: true }),
        field("b", { name: "group", type: FieldType.RADIO, isChecked: false }),
      ],
    });
    const original = store.getState();
    store.getState().saveCheckpoint();
    store.getState().updateField("b", { isChecked: true });
    expect(store.getState().fields.map((f) => f.isChecked)).toEqual([
      false,
      true,
    ]);
    expect(original.fields.map((f) => f.isChecked)).toEqual([true, false]);
    const edited = store.getState();
    store.getState().undo();
    expect(store.getState().fields).toBe(original.fields);
    expect(store.getState().dirtyPermissionScopes).toBe(
      original.dirtyPermissionScopes,
    );
    expect(store.getState().selectedId).toBeNull();
    store.getState().redo();
    expect(store.getState().fields).toBe(edited.fields);
    expect(store.getState().dirtyPermissionScopes).toBe(
      edited.dirtyPermissionScopes,
    );
    expect(store.getState().options).toBe(original.options);
    expect(store.getState().pdfBytes).toBe(original.pdfBytes);
  });

  it("does not checkpoint or mutate a denied edit", () => {
    const store = createTestEditorStore({
      fields: [field()],
      documentPermissions: {
        ...UNRESTRICTED_PDF_PERMISSIONS,
        canModifyContents: false,
        canFillForms: false,
      },
    });
    const original = store.getState();
    expect(() =>
      store.getState().updateField("field-1", { value: "denied" }),
    ).toThrow();
    expect(store.getState()).toBe(original);
  });

  it("merges/excludes/deletes translation candidates immutably and rejects cross-page merges", () => {
    const store = createTestEditorStore();
    const candidates = [
      candidate("a"),
      candidate("b", { rect: { x: 10, y: 40, width: 100, height: 20 } }),
      candidate("c", { pageIndex: 1 }),
    ];
    store.getState().setPageTranslateParagraphCandidates(candidates);
    store.getState().setSelectedPageTranslateParagraphIds(["a", "c"]);
    const incompatible = store.getState();
    store.getState().mergeSelectedPageTranslateParagraphs();
    expect(store.getState()).toBe(incompatible);
    store.getState().setSelectedPageTranslateParagraphIds(["a", "b"]);
    store.getState().mergeSelectedPageTranslateParagraphs();
    const mergedId = store.getState().pageTranslateSelectedParagraphIds[0];
    expect(store.getState().pageTranslateParagraphCandidates[0]).toMatchObject({
      sourceText: "a\nb",
      rect: { x: 10, y: 10, width: 100, height: 50 },
    });
    store.getState().toggleExcludeSelectedPageTranslateParagraphs();
    expect(
      store
        .getState()
        .pageTranslateParagraphCandidates.find((c) => c.id === mergedId)
        ?.isExcluded,
    ).toBe(true);
    store.getState().deleteSelectedPageTranslateParagraphs();
    expect(store.getState().pageTranslateParagraphCandidates).toEqual([
      candidates[2],
    ]);
    expect(store.getState().pageTranslateSelectedParagraphIds).toEqual([]);
    expect(candidates).toHaveLength(3);
    expect(candidates[0].isExcluded).toBe(false);
  });

  it("removes only the requested page candidates and prunes their selection", () => {
    const store = createTestEditorStore();
    store
      .getState()
      .setPageTranslateParagraphCandidates([
        candidate("a"),
        candidate("b", { pageIndex: 1 }),
      ]);
    store.getState().setSelectedPageTranslateParagraphIds(["a", "b"]);
    store.getState().removePageTranslateParagraphCandidatesByPageIndex(0);
    expect(store.getState().pageTranslateSelectedParagraphIds).toEqual(["b"]);
    const after = store.getState();
    store.getState().removePageTranslateParagraphCandidatesByPageIndex(0);
    expect(store.getState()).toBe(after);
  });

  it("keeps nested option merging while leaving unrelated root references intact", () => {
    const store = createTestEditorStore();
    const before = store.getState();
    store.getState().setOptions({ ...before.options, userName: "Test user" });
    expect(store.getState().options.userName).toBe("Test user");
    expect(store.getState().options.aiChat).toEqual(before.options.aiChat);
    expect(store.getState().fields).toBe(before.fields);
    expect(store.getState().past).toBe(before.past);
  });

  it("contains no unnecessary root-state spreads in slice updaters", () => {
    const directory = resolve("src/store/slices");
    for (const name of readdirSync(directory).filter((name) =>
      name.endsWith(".ts"),
    )) {
      expect(readFileSync(resolve(directory, name), "utf8"), name).not.toMatch(
        /\.\.\.state\s*[,}]/,
      );
    }
  });
});
