import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PageEditor from "@/components/page-editor/PageEditor";
import { EditorViewContext } from "@/store/useEditorView";
import { EditorTabActiveContext } from "@/app/editorTabs/context";
import { LanguageProvider } from "@/components/language-provider";
import { getPageId } from "@/services/pdfService/lib/pageStructure";
import { UNRESTRICTED_PDF_PERMISSIONS } from "@/lib/pdfPermissions";
import { createTestEditorStore, page } from "./helpers/editorStore";

const mocks = vi.hoisted(() => ({
  exportPages: vi.fn(),
  start: vi.fn(),
  dispose: vi.fn(),
  toast: {
    promise: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
    loading: vi.fn(),
  },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/services/pdfService/pageClipboard", () => ({
  exportSelectedPages: mocks.exportPages,
}));
vi.mock("@/services/pdfService", () => ({ startPdfOpenSession: mocks.start }));
vi.mock("@/services/pdfService/pdfWorkerService", () => ({
  createPdfWorkerService: () => ({ destroy: vi.fn() }),
}));
vi.mock("@/services/browserDb", () => ({
  APP_DB_STORES: { workspace: "workspace" },
  withAppDb: () => Promise.reject(new Error("No shared storage")),
}));
vi.mock("@/app/editorRuntime", () => ({
  useEditorDocumentIdentityRuntime: () => ({ workerService: null }),
}));
vi.mock("@/components/page-editor/PageGrid", () => ({
  PageGrid: ({
    onCopy,
    onPaste,
  }: {
    onCopy?: (ids?: string[]) => void;
    onPaste?: (index?: number) => void;
  }) => (
    <div data-canvas tabIndex={0}>
      <button data-menu-copy onClick={() => onCopy?.(["original:0"])}>
        Copy
      </button>
      <button data-menu-paste onClick={() => onPaste?.(1)}>
        Paste
      </button>
    </div>
  ),
}));
vi.mock("@/components/page-editor/ImportPreview", () => ({
  ImportPreview: ({
    children,
    imported,
    range,
  }: {
    children: React.ReactNode;
    imported: { filename: string };
    range: string;
  }) => (
    <div data-preview={range}>
      {imported.filename}
      {children}
    </div>
  ),
}));

let host: HTMLDivElement;
let root: Root;
const stores: ReturnType<typeof createTestEditorStore>[] = [];
function store() {
  const value = createTestEditorStore({
    pages: [page(0), page(1), page(2), page(3)],
    mode: "pages",
    filename: "copied.pdf",
  });
  value
    .getState()
    .setSelectedPageIds([
      getPageId(value.getState().pages[1]),
      getPageId(value.getState().pages[3]),
    ]);
  stores.push(value);
  return value;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.exportPages.mockReset().mockResolvedValue(new Blob(["%PDF-copied"]));
  mocks.start.mockReset().mockImplementation(() => {
    const document = {
      pdfBytes: new Uint8Array([1]),
      pages: [page(0), page(1)],
      fields: [],
      annotations: [],
      preservedSourceAnnotations: [],
      documentPermissions: null,
      dispose: mocks.dispose,
    };
    return {
      readable: Promise.resolve(document),
      hydrate: async () => document,
      dispose: mocks.dispose,
    };
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  stores.splice(0).forEach((view) => view.dispose());
  host.remove();
  vi.unstubAllGlobals();
});
const render = (
  view: ReturnType<typeof store>,
  active = true,
  key = "editor",
) =>
  act(async () =>
    root.render(
      <LanguageProvider defaultLanguage="en">
        <EditorViewContext.Provider value={view}>
          <EditorTabActiveContext.Provider value={active}>
            <PageEditor key={key} />
          </EditorTabActiveContext.Provider>
        </EditorViewContext.Provider>
      </LanguageProvider>,
    ),
  );
const clipboard = () => {
  const values = new Map<string, string>();
  return {
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => values.set(type, value),
  } as unknown as DataTransfer;
};
async function dispatch(
  type: "copy" | "paste",
  data: DataTransfer,
  target: Element = host.querySelector("[data-canvas]")!,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: data });
  await act(async () => target.dispatchEvent(event));
  return event;
}
function button(text: string) {
  return [
    ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ].find((button) => button.textContent === text)!;
}

describe("page mode clipboard dialogs", () => {
  it.each([false, true])(
    "uses the existing insertion preview before changing pages (another document: %s)",
    async (different) => {
      const source = store();
      await render(source);
      const data = clipboard();
      expect((await dispatch("copy", data)).defaultPrevented).toBe(true);
      const target = different ? store() : source;
      if (different) await render(target, true, "target");
      target
        .getState()
        .setSelectedPageIds([getPageId(target.getState().pages[1])]);
      const before = target.getState();
      expect((await dispatch("paste", data)).defaultPrevented).toBe(true);
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(
        document.querySelector("[data-preview]")?.getAttribute("data-preview"),
      ).toBe("1-2");
      expect(target.getState().pages).toBe(before.pages);
      expect(target.getState().past).toHaveLength(0);
      expect(mocks.start.mock.calls[0][0]).toBeInstanceOf(File);
      await act(async () => button("Import PDF").click());
      expect(target.getState().pages).toHaveLength(6);
      expect(target.getState().selectedPageIds).toEqual(
        target.getState().pages.slice(2, 4).map(getPageId),
      );
      expect(target.getState().past).toHaveLength(1);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      target.getState().undo();
      expect(target.getState().pages).toBe(before.pages);
      target.getState().redo();
      expect(target.getState().pages).toHaveLength(6);
      if (different) expect(source.getState().pages).toHaveLength(4);
    },
  );

  it("uses menu copy IDs and insertion position without changing keyboard defaults", async () => {
    let text = "";
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn(async (value: string) => {
          text = value;
        }),
        readText: vi.fn(async () => text),
      },
    });
    const view = store();
    await render(view);
    await act(async () =>
      host.querySelector<HTMLButtonElement>("[data-menu-copy]")!.click(),
    );
    expect(mocks.exportPages.mock.calls[0][0].selectedPageIds).toEqual([
      "original:0",
    ]);
    const before = view.getState().pages;
    await act(async () =>
      host.querySelector<HTMLButtonElement>("[data-menu-paste]")!.click(),
    );
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(view.getState().pages).toBe(before);
    await act(async () => button("Import PDF").click());
    expect(view.getState().pages[0]).toMatchObject({ pageIndex: 0 });
    expect(view.getState().selectedPageIds).toEqual(
      view.getState().pages.slice(1, 3).map(getPageId),
    );
    expect(view.getState().past).toHaveLength(1);
  });

  it("cancels insertion without changing history and allows another paste", async () => {
    const view = store();
    await render(view);
    const data = clipboard();
    await dispatch("copy", data);
    await dispatch("paste", data);
    await act(async () => button("Cancel").click());
    expect(view.getState().pages).toHaveLength(4);
    expect(view.getState().past).toHaveLength(0);
    await dispatch("paste", data);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("respects background tabs, empty selection, text fields and target permissions", async () => {
    const view = store();
    const data = clipboard();
    await render(view, false);
    expect((await dispatch("copy", data)).defaultPrevented).toBe(false);
    await render(view);
    await dispatch("copy", data);
    view.getState().setSelectedPageIds([]);
    expect((await dispatch("copy", data)).defaultPrevented).toBe(false);
    const input = document.createElement("input");
    host.append(input);
    input.focus();
    expect((await dispatch("paste", data, input)).defaultPrevented).toBe(false);
    input.remove();
    view.setState({
      documentPermissions: {
        ...UNRESTRICTED_PDF_PERMISSIONS,
        canAssemble: false,
      },
    });
    expect((await dispatch("paste", data)).defaultPrevented).toBe(true);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(view.getState().pages).toHaveLength(4);
  });

  it("waits for an in-progress copy and ignores it after the page editor closes", async () => {
    let resolve!: (blob: Blob) => void;
    mocks.exportPages.mockReturnValue(
      new Promise<Blob>((yes) => {
        resolve = yes;
      }),
    );
    const view = store();
    await render(view);
    const data = clipboard();
    await dispatch("copy", data);
    await dispatch("paste", data);
    expect(mocks.start).not.toHaveBeenCalled();
    await act(async () => root.render(null));
    await act(async () => resolve(new Blob(["%PDF-copied"])));
    expect(mocks.start).not.toHaveBeenCalled();
    expect(view.getState().pages).toHaveLength(4);
  });
});
