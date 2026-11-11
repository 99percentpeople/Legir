import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FieldType, type FormField } from "@/types";
import { DropdownControl } from "@/components/workspace/controls/form/DropdownControl";
import { DropdownProperties } from "@/components/workspace/controls/properties/DropdownProperties";
import type { FormControlProps } from "@/components/workspace/controls/types";

const drag = vi.hoisted(() => ({
  start: undefined as (() => void) | undefined,
  end: undefined as
    | ((event: {
        canceled: boolean;
        operation: { source: { initialIndex: number; index: number } | null };
      }) => void)
    | undefined,
  ids: [] as string[],
}));
vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: ({
    children,
    onDragStart,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragStart: typeof drag.start;
    onDragEnd: typeof drag.end;
  }) => {
    drag.start = onDragStart;
    drag.end = onDragEnd;
    return children;
  },
}));
vi.mock("@dnd-kit/react/sortable", () => ({
  isSortable: (source: unknown) => !!source,
  useSortable: ({ id }: { id: string }) => {
    drag.ids.push(id);
    return { ref: () => {}, handleRef: () => {} };
  },
}));
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
  drag.ids = [];
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = async (ui: React.ReactNode) => {
  await act(async () => root.render(ui));
};
const field = (patch: Partial<FormField> = {}): FormField => ({
  id: "choice",
  name: "Choice",
  pageIndex: 0,
  type: FieldType.DROPDOWN,
  rect: { x: 10, y: 10, width: 180, height: 100 },
  style: { fontSize: 12, borderWidth: 1 },
  options: ["One", "Two", "Three"],
  value: "Two",
  ...patch,
});
const props = (data: FormField): FormControlProps => ({
  id: data.id,
  data,
  isSelected: false,
  isSelectable: true,
  isAnnotationMode: true,
  isFormMode: false,
  onUpdate: vi.fn(),
  onSelect: vi.fn(),
  onPointerDown: vi.fn(),
});

describe("list-box canvas presentation", () => {
  it.each([false, true])(
    "shows single-select Listbox rows in fill/design mode (design=%s)",
    async (design) => {
      await render(
        <DropdownControl
          {...props(field({ isListBox: true }))}
          isFormMode={design}
          isAnnotationMode={!design}
        />,
      );
      const select = host.querySelector("select")!;
      expect(select.size).toBeGreaterThan(1);
      expect(select.multiple).toBe(false);
      expect(select.disabled).toBe(design);
      expect(select.options).toHaveLength(3);
      expect(select.selectedOptions[0].textContent).toBe("Two");
      expect(host.querySelector(".lucide-chevron-down")).toBeNull();
    },
  );
  it("shows all options for legacy multi-select fields in design mode", async () => {
    await render(
      <DropdownControl
        {...props(field({ isMultiSelect: true, value: "One\nThree" }))}
        isFormMode
        isAnnotationMode={false}
      />,
    );
    const select = host.querySelector("select")!;
    expect(select.multiple).toBe(true);
    expect(select.selectedOptions).toHaveLength(2);
  });
  it("retains a native select for a real dropdown", async () => {
    await render(<DropdownControl {...props(field({ isListBox: false }))} />);
    expect(host.querySelector("select")?.value).toBe("Two");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });
  it.each([{ readOnly: true }, { canFillFormValue: false }])(
    "does not enable list choices without fill permission (%j)",
    async (restriction) => {
      await render(
        <DropdownControl
          {...props(field({ isListBox: true, readOnly: restriction.readOnly }))}
          canFillFormValue={restriction.canFillFormValue}
        />,
      );
      expect(host.querySelector("select")?.disabled).toBe(true);
    },
  );
  it.each([[], ["Only"], ["One", "Two"]])(
    "keeps an unselected list empty with options %j",
    async (...options) => {
      await render(
        <DropdownControl
          {...props(field({ isListBox: true, options, value: "" }))}
        />,
      );
      const select = host.querySelector("select")!;
      expect(select.size).toBeGreaterThan(1);
      expect(select.selectedIndex).toBe(-1);
      expect(select.selectedOptions).toHaveLength(0);
    },
  );
  it.each([false, true])(
    "saves a checkpoint before a native selection change (multiple=%s)",
    async (multiple) => {
      const controlProps = props(
        field({ isListBox: true, isMultiSelect: multiple }),
      );
      const history = vi.fn();
      await render(
        <DropdownControl {...controlProps} onTriggerHistorySave={history} />,
      );
      const select = host.querySelector("select")!;
      await act(async () => {
        for (const option of select.options) {
          option.selected =
            option.value === "2" || (multiple && option.value === "0");
        }
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(history).toHaveBeenCalledOnce();
      expect(controlProps.onUpdate).toHaveBeenCalledExactlyOnceWith("choice", {
        value: multiple ? "One\nThree" : "Three",
      });
      expect(history.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(controlProps.onUpdate).mock.invocationCallOrder[0],
      );
    },
  );
});

describe("choice option drag sorting", () => {
  it("renders left-hand drag handles and always-visible delete controls", async () => {
    await render(
      <DropdownProperties
        data={field()}
        onChange={vi.fn()}
        onTriggerHistorySave={vi.fn()}
      />,
    );
    const rows = host.querySelectorAll("[data-choice-option]");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(
        row.firstElementChild?.hasAttribute("data-choice-option-handle"),
      ).toBe(true);
      expect(
        row.firstElementChild?.getAttribute("data-app-keyboard-handle"),
      ).toBe("choice-option-sort");
      const remove = row.querySelector("[data-choice-option-delete]")!;
      expect(remove.className).not.toMatch(/opacity-0|group-hover/);
      expect(remove.getAttribute("aria-label")).toBeTruthy();
    }
    expect(
      host.querySelector(".lucide-arrow-up,.lucide-arrow-down"),
    ).toBeNull();
  });
  it("commits exactly one checkpoint on drop without replacing current/default values", async () => {
    const onChange = vi.fn(),
      history = vi.fn();
    await render(
      <DropdownProperties
        data={field({ defaultValue: "Three" })}
        onChange={onChange}
        onTriggerHistorySave={history}
      />,
    );
    await act(async () => drag.start!());
    expect(history).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    await act(async () =>
      drag.end!({
        canceled: false,
        operation: { source: { initialIndex: 0, index: 2 } },
      }),
    );
    expect(history).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      options: ["Two", "Three", "One"],
    });
    expect(history.mock.invocationCallOrder[0]).toBeLessThan(
      onChange.mock.invocationCallOrder[0],
    );
  });
  it.each([true, false])(
    "ignores a canceled/no-op drop (cancel=%s)",
    async (canceled) => {
      const onChange = vi.fn(),
        history = vi.fn();
      await render(
        <DropdownProperties
          data={field()}
          onChange={onChange}
          onTriggerHistorySave={history}
        />,
      );
      await act(async () => {
        drag.start!();
        drag.end!({
          canceled,
          operation: { source: { initialIndex: 0, index: canceled ? 2 : 0 } },
        });
      });
      expect(history).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    },
  );
  it("rejects a stale drag after the option list has changed", async () => {
    const onChange = vi.fn(),
      history = vi.fn();
    await render(
      <DropdownProperties
        data={field()}
        onChange={onChange}
        onTriggerHistorySave={history}
      />,
    );
    await act(async () => drag.start!());
    await render(
      <DropdownProperties
        data={field({ options: ["New"] })}
        onChange={onChange}
        onTriggerHistorySave={history}
      />,
    );
    await act(async () =>
      drag.end!({
        canceled: false,
        operation: { source: { initialIndex: 0, index: 2 } },
      }),
    );
    expect(onChange).not.toHaveBeenCalled();
  });
  it("uses unique sortable IDs for duplicate option labels and deletes the intended row", async () => {
    const onChange = vi.fn();
    await render(
      <DropdownProperties
        data={field({ options: ["Same", "Same", "Other"] })}
        onChange={onChange}
        onTriggerHistorySave={vi.fn()}
      />,
    );
    expect(new Set(drag.ids).size).toBe(3);
    await act(async () =>
      host
        .querySelectorAll<HTMLButtonElement>("[data-choice-option-delete]")[1]
        .click(),
    );
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      options: ["Same", "Other"],
    });
  });
});
