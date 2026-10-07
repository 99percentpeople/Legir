import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckboxControl } from "@/components/workspace/controls/form/CheckboxControl";
import { RadioControl } from "@/components/workspace/controls/form/RadioControl";
import { SignatureControl } from "@/components/workspace/controls/form/SignatureControl";
import { FloatingToolbar } from "@/components/workspace/controls/FloatingToolbar";
import type { FormControlProps } from "@/components/workspace/controls/types";
import { FieldType } from "@/types";
import { useEditorPageKeyboardShortcuts } from "@/pages/EditorPage/hooks/useEditorPageKeyboardShortcuts";
import { EditorViewContext } from "@/store/useEditorView";
import { createTestEditorStore } from "../helpers/editorStore";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete document.body.dataset.appControlTransforming;
  vi.unstubAllGlobals();
});

const render = async (element: React.ReactNode) => {
  await act(async () => root.render(element));
};

const controlProps = (type: FieldType): FormControlProps => ({
  id: "field",
  data: {
    id: "field",
    type,
    name: "Test field",
    pageIndex: 0,
    rect: { x: 0, y: 0, width: 80, height: 40 },
  },
  isSelected: false,
  isSelectable: true,
  isAnnotationMode: true,
  isFormMode: false,
  onPointerDown: vi.fn(),
  onSelect: vi.fn(),
  onUpdate: vi.fn(),
});

describe("form control interaction", () => {
  it.each([
    ["checkbox", FieldType.CHECKBOX, CheckboxControl],
    ["radio", FieldType.RADIO, RadioControl],
  ] as const)(
    "%s blocks read-only and disallowed fills, then allows a focused activation",
    async (_name, type, Control) => {
      const props = controlProps(type);
      await render(
        <Control {...props} data={{ ...props.data, readOnly: true }} />,
      );
      await act(async () => host.querySelector("button")!.click());
      expect(props.onUpdate).not.toHaveBeenCalled();

      await render(<Control {...props} canFillFormValue={false} />);
      await act(async () => host.querySelector("button")!.click());
      expect(props.onUpdate).not.toHaveBeenCalled();

      await render(<Control {...props} />);
      await act(async () => {
        const button = host.querySelector("button")!;
        button.focus();
        button.click();
      });
      expect(props.onSelect).toHaveBeenCalledWith("field");
      expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith("field", {
        isChecked: true,
      });
    },
  );

  it("does not open the signature file picker for read-only fields", async () => {
    const props = controlProps(FieldType.SIGNATURE);
    const openPicker = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    await render(
      <SignatureControl {...props} data={{ ...props.data, readOnly: true }} />,
    );
    const clickField = async () =>
      act(async () => {
        host.querySelector<HTMLElement>(".overflow-hidden")!.click();
      });
    await clickField();
    expect(openPicker).not.toHaveBeenCalled();

    await render(<SignatureControl {...props} />);
    await clickField();
    expect(openPicker).toHaveBeenCalledOnce();
    expect(props.onUpdate).not.toHaveBeenCalled();
  });
});

describe("annotation toolbar focus", () => {
  it("preserves text focus and selection when shown, transformed, and hidden", async () => {
    const toolbar = (visible: boolean) => (
      <>
        <input defaultValue="draft" />
        <FloatingToolbar isVisible={visible}>
          <button>Edit annotation</button>
        </FloatingToolbar>
      </>
    );
    await render(toolbar(false));
    const input = host.querySelector("input")!;
    input.focus();
    input.setSelectionRange(1, 3);

    for (let index = 0; index < 2; index++) {
      await render(toolbar(true));
      expect(document.activeElement).toBe(input);
      for (const active of [true, false]) {
        await act(async () => {
          window.dispatchEvent(
            new CustomEvent("app-control-transforming", {
              detail: { active },
            }),
          );
        });
        expect(document.activeElement).toBe(input);
      }
      await render(toolbar(false));
      expect(document.activeElement).toBe(input);
      expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
    }
  });
});

describe("control keyboard ownership", () => {
  it("reserves Space for focused controls and still pans from the canvas", async () => {
    const store = createTestEditorStore({ tool: "select" });
    function KeyboardProbe() {
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
          <button role="checkbox" aria-checked={false}>
            Check
          </button>
          <div role="option" tabIndex={0}>
            Choice
          </div>
          <select>
            <option>Choice</option>
          </select>
          <div data-canvas tabIndex={0} />
        </>
      );
    }
    await render(
      <EditorViewContext.Provider value={store}>
        <KeyboardProbe />
      </EditorViewContext.Provider>,
    );

    for (const selector of ["button", "[role='option']", "select"]) {
      const target = host.querySelector<HTMLElement>(selector)!;
      const event = new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        target.focus();
        target.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(false);
      expect(store.getState().tool).toBe("select");
      expect(store.getState().keys.space).toBe(false);
    }

    const canvas = host.querySelector<HTMLElement>("[data-canvas]")!;
    await act(async () => {
      canvas.focus();
      canvas.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(store.getState().tool).toBe("pan");
    await act(async () => {
      canvas.dispatchEvent(
        new KeyboardEvent("keyup", { key: " ", bubbles: true }),
      );
    });
    expect(store.getState().tool).toBe("select");
    expect(store.getState().keys.space).toBe(false);
  });
});
