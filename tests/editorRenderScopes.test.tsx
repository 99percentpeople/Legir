import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EditorRuntimeProvider,
  type EditorTabsRuntime,
  type EditorDocumentRuntime,
} from "@/app/editorRuntime";
import { useEditorStore } from "@/store/useEditorStore";
import type { AiChatEditorState } from "@/store/selectors";
import type { PDFSearchResult } from "@/types";
import { candidate, field, page } from "./helpers/editorStore";
import EditorPage from "@/pages/EditorPage";

const metrics = vi.hoisted(() => ({
  renders: {} as Record<string, number>,
  stream: undefined as ((text: string) => void) | undefined,
  highlight: undefined as
    | ((value: Map<number, PDFSearchResult[]>) => void)
    | undefined,
  readSnapshot: undefined as (() => AiChatEditorState) | undefined,
}));

// Count hook invocations during REAL connector renders, not selector executions
// during store notifications. PDF/AI/network leaf implementations are replaced
// with deterministic probes; EditorPage and every RightPanel connector are real.
vi.mock("zustand/react/shallow", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("zustand/react/shallow")>();
  return {
    useShallow: <S, U>(selector: (state: S) => U) => {
      metrics.renders[selector.name] =
        (metrics.renders[selector.name] ?? 0) + 1;
      return original.useShallow(selector);
    },
  };
});

vi.mock("@/components/language-provider", () => {
  const t = (key: string) => key;
  return { useLanguage: () => ({ t, effectiveLanguage: "en" }) };
});
vi.mock("@/hooks/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("@/services/platform", () => ({
  exitPlatformFullscreen: async () => {},
  setPlatformFullscreen: async () => {},
  subscribePlatformFullscreenChange: () => () => {},
}));
vi.mock("@/pages/EditorPage/hooks/useEditorPageLifecycle", () => ({
  useEditorPageLifecycle: () => ({
    workspaceScrollContainerRef: React.useRef(null),
  }),
}));
vi.mock("@/pages/EditorPage/components/EditorTabStrip", async () => {
  const { useEditorTabsRuntime } = await import("@/app/editorRuntime");
  return {
    EditorTabStrip: () => {
      useEditorTabsRuntime();
      metrics.renders.tabStrip = (metrics.renders.tabStrip ?? 0) + 1;
      return null;
    },
  };
});
vi.mock("@/components/properties-panel/RightPanelTabDock", () => ({
  RightPanelTabDock: () => null,
}));
vi.mock("@/components/workspace/widgets/TranslationFloatingWindow", () => ({
  TranslationFloatingWindow: () => null,
}));
vi.mock("@/components/toolbar/Toolbar", async () => {
  const { useEditorPdfSearchToolbar } =
    await import("@/app/editorShellContext");
  const { selectToolbarState } = await import("@/store/selectors");
  const { useShallow } = await import("zustand/react/shallow");
  return {
    default: () => {
      useEditorStore(useShallow(selectToolbarState));
      useEditorPdfSearchToolbar();
      return null;
    },
  };
});
vi.mock("@/components/sidebar/Sidebar", async () => {
  const { useEditorPdfSearchSidebar } =
    await import("@/app/editorShellContext");
  return {
    default: () => {
      useEditorPdfSearchSidebar();
      return null;
    },
  };
});
vi.mock("@/pages/EditorPage/EditorCanvasPane", async () => {
  const { useEditorPdfSearchWorkspace } =
    await import("@/app/editorShellContext");
  const { useEditorFileDragRuntime } = await import("@/app/editorRuntime");
  const { selectEditorCanvasState } = await import("@/store/selectors");
  const { useShallow } = await import("zustand/react/shallow");
  return {
    EditorCanvasPane: () => {
      useEditorStore(useShallow(selectEditorCanvasState));
      useEditorPdfSearchWorkspace();
      useEditorFileDragRuntime();
      return null;
    },
  };
});
vi.mock("@/components/properties-panel/PropertiesPanel", () => ({
  PropertiesPanel: () => <div data-panel="properties" />,
}));
vi.mock("@/components/properties-panel/PageTranslatePanel", () => ({
  PageTranslatePanel: () => <div data-panel="translate" />,
}));
vi.mock("@/hooks/usePageTranslation", () => {
  const noop = () => {};
  return {
    usePageTranslation: () => ({
      isPageTranslating: false,
      pageTranslateStatus: null,
      cancelPageTranslate: noop,
      handleStartPageTranslate: noop,
      handlePreviewParagraphs: noop,
      handleUnmergeSelectedParagraphs: noop,
    }),
  };
});
vi.mock("@/hooks/useAiChatController", () => ({
  useAiChatController: (
    _state: unknown,
    _scope: unknown,
    _worker: unknown,
    reader: () => AiChatEditorState,
  ) => {
    const [text, setText] = React.useState("");
    const [highlights, setHighlights] = React.useState(
      () => new Map<number, PDFSearchResult[]>(),
    );
    metrics.stream = setText;
    metrics.highlight = setHighlights;
    metrics.readSnapshot = reader;
    return React.useMemo(
      () => ({ text, highlightedSearchResultsByPage: highlights }),
      [text, highlights],
    );
  },
}));
vi.mock("@/components/properties-panel/AiChatPanel", () => ({
  AiChatPanel: ({ aiChat }: { aiChat: { text: string } }) => {
    metrics.renders.aiLeaf = (metrics.renders.aiLeaf ?? 0) + 1;
    return <div data-panel="ai">{aiChat.text}</div>;
  },
}));

const resetCounts = () => {
  metrics.renders = {};
};
const count = (name: string) => metrics.renders[name] ?? 0;
const expectQuiet = (...names: string[]) =>
  names.forEach((name) => expect(count(name), name).toBe(0));
const settleImports = async () => {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
};

let root: Root;
let container: HTMLDivElement;
let tabs: EditorTabsRuntime;
let documentRuntime: EditorDocumentRuntime;
let pageElement: React.ReactElement;
const renderPage = async () => {
  await act(async () =>
    root.render(
      <EditorRuntimeProvider tabs={tabs} document={documentRuntime}>
        {pageElement}
      </EditorRuntimeProvider>,
    ),
  );
  await settleImports();
};
const openPanel = async (tab: string) => {
  await act(async () => useEditorStore.getState().openRightPanel(tab));
  await settleImports();
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  useEditorStore.setState(
    {
      ...useEditorStore.getInitialState(),
      documentLoadState: "ready",
      pages: [page()],
      pdfBytes: new Uint8Array([1]),
      filename: "Test.pdf",
      fields: [field("selected"), field("other")],
      isPanelFloating: false,
      isSidebarOpen: false,
      isRightPanelOpen: false,
      rightPanelTab: "document",
      selectedId: null,
      mode: "form",
      scale: 1,
    },
    true,
  );
  const noop = () => {};
  const asyncNoop = async () => {};
  tabs = {
    windowId: "window-a",
    activeTabId: "tab-a",
    tabs: [],
    mergeWindowTargets: [],
    canDetachTabs: false,
    canMergeTabs: false,
    openDocument: asyncNoop,
    refreshMergeWindowTargets: asyncNoop,
    selectTab: noop,
    closeTab: noop,
    moveTab: noop,
    detachTab: asyncNoop,
    mergeTabToWindow: asyncNoop,
  };
  documentRuntime = {
    sessionRenderKey: "tab-a",
    workerService: null,
    isFileDragActive: false,
    save: async () => true,
    saveAs: async () => true,
    exit: noop,
    print: noop,
    requestCloseCurrentTab: noop,
  };
  pageElement = <EditorPage />;
  metrics.stream = undefined;
  metrics.readSnapshot = undefined;
  resetCounts();
  await renderPage();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("editor connector render scope", () => {
  it("separates cold mount from 20 warm-visible and warm-hidden zoom updates", async () => {
    expect(metrics.stream).toBeUndefined();
    resetCounts();
    await act(async () => useEditorStore.getState().setScale(1.25));
    expectQuiet(
      "selectEditorPageState",
      "selectRightPanelShellState",
      "selectAiChatReactiveState",
    );
    await openPanel("ai_chat");
    expect(metrics.stream).toBeDefined();
    expect(count("selectAiChatReactiveState")).toBeGreaterThan(0);
    for (const tab of ["ai_chat", "document"]) {
      await openPanel(tab);
      resetCounts();
      for (let index = 0; index < 20; index++) {
        await act(async () =>
          useEditorStore.getState().setScale(1 + (index + 1) / 10),
        );
        expect(metrics.readSnapshot?.().scale).toBe(
          useEditorStore.getState().scale,
        );
      }
      expectQuiet(
        "selectEditorPageState",
        "selectRightPanelShellState",
        "selectAiChatReactiveState",
        "aiLeaf",
      );
      expect(count("selectEditorCanvasState")).toBeGreaterThan(0);
      expect(count("selectToolbarState")).toBeGreaterThan(0);
    }
  });

  it("expires old AI readers across A/B/A activation even when tabs share PDF bytes", async () => {
    await openPanel("ai_chat");
    const readA = metrics.readSnapshot!;
    expect(readA().filename).toBe("Test.pdf");
    const originalRuntime = documentRuntime;
    const originalTabs = tabs;
    tabs = { ...tabs, activeTabId: "tab-b" };
    documentRuntime = { ...documentRuntime, sessionRenderKey: "tab-b" };
    await renderPage();
    const readB = metrics.readSnapshot!;
    expect(readA).toThrow("no longer active");
    expect(() => readB()).not.toThrow();
    tabs = originalTabs;
    documentRuntime = originalRuntime;
    await renderPage();
    expect(readA).toThrow("no longer active");
    expect(readB).toThrow("no longer active");
    expect(() => metrics.readSnapshot!()).not.toThrow();
  });

  it("invalidates AI readers after a worker replacement or panel unmount", async () => {
    await openPanel("ai_chat");
    const oldReader = metrics.readSnapshot!;
    documentRuntime = {
      ...documentRuntime,
      workerService: {} as NonNullable<EditorDocumentRuntime["workerService"]>,
    };
    await renderPage();
    expect(oldReader).toThrow("no longer active");
    const currentReader = metrics.readSnapshot!;
    await act(async () => root.render(null));
    expect(currentReader).toThrow("no longer active");
  });

  it("keeps the current reader valid after StrictMode effect replay", async () => {
    pageElement = (
      <React.StrictMode>
        <EditorPage />
      </React.StrictMode>
    );
    await renderPage();
    await openPanel("ai_chat");
    const reader = metrics.readSnapshot!;
    expect(() => reader()).not.toThrow();
    await act(async () => useEditorStore.getState().setScale(2));
    expect(reader().scale).toBe(2);
  });

  it("does not wake AI or the shell for unrelated control/metadata changes", async () => {
    await openPanel("ai_chat");
    resetCounts();
    await act(async () => {
      useEditorStore.getState().updateField("other", { value: "updated" });
      useEditorStore.getState().updateMetadata({ title: "Updated metadata" });
      useEditorStore.setState({
        annotations: [{ id: "note", type: "comment", pageIndex: 0 }],
      });
    });
    expectQuiet(
      "selectEditorPageState",
      "selectRightPanelShellState",
      "selectAiChatReactiveState",
      "aiLeaf",
    );
    expect(metrics.readSnapshot?.().metadata.title).toBe("Updated metadata");
  });

  it("renders only the translation connector and workspace for candidate changes", async () => {
    await openPanel("ai_chat");
    await openPanel("page_translate");
    resetCounts();
    await act(async () =>
      useEditorStore
        .getState()
        .setPageTranslateParagraphCandidates([candidate("a")]),
    );
    expect(count("selectPageTranslateRightPanelState")).toBeGreaterThan(0);
    expect(count("selectEditorCanvasState")).toBeGreaterThan(0);
    expectQuiet(
      "selectEditorPageState",
      "selectRightPanelShellState",
      "selectAiChatReactiveState",
      "aiLeaf",
    );
    resetCounts();
    await act(async () =>
      useEditorStore.getState().updateMetadata({ title: "Unrelated" }),
    );
    expectQuiet(
      "selectPageTranslateRightPanelState",
      "selectRightPanelShellState",
      "selectAiChatReactiveState",
    );
  });

  it("subscribes the properties connector only to the selected control", async () => {
    await act(async () => useEditorStore.getState().selectControl("selected"));
    await openPanel("properties");
    resetCounts();
    await act(async () =>
      useEditorStore.getState().updateField("other", { value: "other" }),
    );
    expectQuiet(
      "selectPropertiesRightPanelState",
      "selectRightPanelShellState",
    );
    await act(async () =>
      useEditorStore.getState().updateField("selected", { value: "selected" }),
    );
    expect(count("selectPropertiesRightPanelState")).toBeGreaterThan(0);
    expectQuiet("selectRightPanelShellState");
  });

  it("isolates ten streamed AI updates from the page, toolbar and canvas", async () => {
    await openPanel("ai_chat");
    resetCounts();
    for (let index = 0; index < 10; index++) {
      await act(async () => metrics.stream?.(`token ${index}`));
    }
    expect(count("aiLeaf")).toBe(10);
    expectQuiet(
      "selectEditorPageState",
      "selectRightPanelShellState",
      "selectEditorCanvasState",
      "selectToolbarState",
    );
    expect(container.textContent).toContain("token 9");
    await act(async () => metrics.highlight?.(new Map([[0, []]])));
    expect(count("selectEditorCanvasState")).toBeGreaterThan(0);
  });

  it("limits drag-state updates to drag consumers", async () => {
    await openPanel("ai_chat");
    resetCounts();
    documentRuntime = { ...documentRuntime, isFileDragActive: true };
    await renderPage();
    expect(count("selectEditorCanvasState")).toBeGreaterThan(0);
    expectQuiet(
      "selectEditorPageState",
      "selectRightPanelShellState",
      "selectAiChatReactiveState",
      "selectToolbarState",
    );
  });

  it("does not refresh the page for tab-list/merge-target churn with unchanged summary", async () => {
    await openPanel("ai_chat");
    resetCounts();
    tabs = { ...tabs, tabs: [], mergeWindowTargets: [] };
    await renderPage();
    expect(count("tabStrip")).toBeGreaterThan(0);
    expectQuiet(
      "selectEditorPageState",
      "selectRightPanelShellState",
      "selectAiChatReactiveState",
      "selectEditorCanvasState",
    );
  });
});
