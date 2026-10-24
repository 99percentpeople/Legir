import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorTabActiveContext } from "@/app/editorTabs/context";
import { useEditorPageKeyboardShortcuts } from "@/pages/EditorPage/hooks/useEditorPageKeyboardShortcuts";
import { EditorViewContext } from "@/store/useEditorView";
import { createTestEditorStore, field } from "../helpers/editorStore";

let host: HTMLDivElement;
let root: Root;
const stores: ReturnType<typeof createTestEditorStore>[] = [];
const store = () => {
  const view = createTestEditorStore({
    fields: [field()],
    selectedId: "field-1",
  });
  stores.push(view);
  return view;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  stores.splice(0).forEach((view) => view.dispose());
  host.remove();
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});

function Probe() {
  useEditorPageKeyboardShortcuts({
    defaultTool: "select",
    isPdfSearchOpen: false,
    openPdfSearch: vi.fn(),
    closePdfSearch: vi.fn(),
    runPrimarySaveAction: async () => true,
    onPrint: vi.fn(),
    onToggleFullscreen: vi.fn(),
  });
  return (
    <>
      <div data-canvas tabIndex={0}>
        PDF text
      </div>
      <input defaultValue="field text" />
      <textarea defaultValue="reply text" />
      <div contentEditable suppressContentEditableWarning>
        <span>editable</span>
      </div>
      <div role="dialog">
        <button>Dialog</button>
      </div>
    </>
  );
}

const clipboard = () => {
  const values = new Map<string, string>();
  return {
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => values.set(type, value),
  } as unknown as DataTransfer;
};

const dispatch = async (
  type: "copy" | "paste",
  data: DataTransfer,
  target: Element = host.querySelector("[data-canvas]")!,
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: data });
  await act(async () => target.dispatchEvent(event));
  return event;
};

describe("control clipboard event ownership", () => {
  it("undoes and redoes pastes without invoking browser shortcuts", async () => {
    const view = store();
    await act(async () =>
      root.render(
        <EditorViewContext.Provider value={view}>
          <Probe />
        </EditorViewContext.Provider>,
      ),
    );
    const data = clipboard();
    await dispatch("copy", data);
    await dispatch("paste", data);
    for (const [key, count] of [
      ["z", 1],
      ["y", 2],
    ] as const) {
      const event = new KeyboardEvent("keydown", {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      await act(async () =>
        host.querySelector("[data-canvas]")!.dispatchEvent(event),
      );
      expect(event.defaultPrevented).toBe(true);
      expect(view.getState().fields).toHaveLength(count);
    }
  });

  it("copies from the active tab and pastes once into a different active tab", async () => {
    const source = store();
    const target = store();
    const render = (sourceActive: boolean) =>
      act(async () =>
        root.render(
          <>
            <EditorViewContext.Provider value={source}>
              <EditorTabActiveContext.Provider value={sourceActive}>
                <Probe />
              </EditorTabActiveContext.Provider>
            </EditorViewContext.Provider>
            <EditorViewContext.Provider value={target}>
              <EditorTabActiveContext.Provider value={!sourceActive}>
                <Probe />
              </EditorTabActiveContext.Provider>
            </EditorViewContext.Provider>
          </>,
        ),
      );
    await render(true);
    const data = clipboard();
    expect((await dispatch("copy", data)).defaultPrevented).toBe(true);
    await render(false);
    expect((await dispatch("paste", data)).defaultPrevented).toBe(true);
    expect(source.getState().fields).toHaveLength(1);
    expect(target.getState().fields).toHaveLength(2);
    expect(target.getState().past).toHaveLength(1);
  });

  it("leaves text inputs, contenteditable descendants, dialogs and PDF text selections native", async () => {
    const view = store();
    await act(async () =>
      root.render(
        <EditorViewContext.Provider value={view}>
          <Probe />
        </EditorViewContext.Provider>,
      ),
    );
    const data = clipboard();
    await dispatch("copy", data);
    const copied = data.getData("text/plain");
    for (const selector of [
      "input",
      "textarea",
      "[contenteditable] span",
      "[role=dialog] button",
    ]) {
      const target = host.querySelector<HTMLElement>(selector)!;
      target.focus();
      expect((await dispatch("copy", data, target)).defaultPrevented).toBe(
        false,
      );
      expect((await dispatch("paste", data, target)).defaultPrevented).toBe(
        false,
      );
      expect(data.getData("text/plain")).toBe(copied);
      target.blur();
    }
    const range = document.createRange();
    range.selectNodeContents(host.querySelector("[data-canvas]")!);
    window.getSelection()!.addRange(range);
    expect((await dispatch("copy", data)).defaultPrevented).toBe(false);
    expect(view.getState().fields).toHaveLength(1);
    expect(view.getState().past).toHaveLength(0);
  });

  it("does not use stale controls for ordinary text, page mode, loading or an open app dialog", async () => {
    const view = store();
    await act(async () =>
      root.render(
        <EditorViewContext.Provider value={view}>
          <Probe />
        </EditorViewContext.Provider>,
      ),
    );
    const data = clipboard();
    data.setData("text/plain", "ordinary text");
    expect((await dispatch("paste", data)).defaultPrevented).toBe(false);
    await dispatch("copy", data);
    for (const patch of [
      { mode: "pages" },
      { documentLoadState: "hydrating" },
      { activeDialog: "shortcuts" },
    ] as const) {
      view.setState({
        mode: "annotation",
        documentLoadState: "ready",
        activeDialog: null,
        ...patch,
      });
      expect((await dispatch("copy", data)).defaultPrevented).toBe(false);
      expect((await dispatch("paste", data)).defaultPrevented).toBe(false);
    }
    expect(view.getState().fields).toHaveLength(1);
  });
});
