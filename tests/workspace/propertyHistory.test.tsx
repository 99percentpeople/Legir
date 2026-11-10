import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FieldType, type FormField } from "@/types";
import { TextProperties } from "@/components/workspace/controls/properties/TextProperties";
import { CheckboxProperties } from "@/components/workspace/controls/properties/CheckboxProperties";
import { RadioProperties } from "@/components/workspace/controls/properties/RadioProperties";
import { DropdownProperties } from "@/components/workspace/controls/properties/DropdownProperties";
import { AppearanceProperties } from "@/components/workspace/controls/properties/AppearanceProperties";
import { createTestEditorStore, field } from "../helpers/editorStore";

vi.mock("@/lib/system-fonts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/system-fonts")>()),
  getSystemFontFamilies: async () => [],
}));
vi.mock("@/components/workspace/controls/properties/ChoiceOptionsList", () => ({
  ChoiceOptionsList: () => null,
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
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const cases = [
  {
    name: "text required",
    component: TextProperties,
    type: FieldType.TEXT,
    property: "required",
  },
  {
    name: "text read-only",
    component: TextProperties,
    type: FieldType.TEXT,
    property: "readOnly",
  },
  {
    name: "text multiline",
    component: TextProperties,
    type: FieldType.TEXT,
    property: "multiline",
  },
  {
    name: "checkbox required",
    component: CheckboxProperties,
    type: FieldType.CHECKBOX,
    property: "required",
  },
  {
    name: "checkbox read-only",
    component: CheckboxProperties,
    type: FieldType.CHECKBOX,
    property: "readOnly",
  },
  {
    name: "radio required",
    component: RadioProperties,
    type: FieldType.RADIO,
    property: "required",
  },
  {
    name: "radio read-only",
    component: RadioProperties,
    type: FieldType.RADIO,
    property: "readOnly",
  },
  {
    name: "dropdown required",
    component: DropdownProperties,
    type: FieldType.DROPDOWN,
    property: "required",
  },
  {
    name: "dropdown read-only",
    component: DropdownProperties,
    type: FieldType.DROPDOWN,
    property: "readOnly",
  },
  {
    name: "field transparency",
    component: AppearanceProperties,
    type: FieldType.TEXT,
    property: "isTransparent",
  },
] as const;

describe.each(cases)(
  "$name history",
  ({ component: Properties, type, property }) => {
    it.each(["mouse", "keyboard", "label"])(
      "creates one undoable change through %s activation",
      async (activation) => {
        const initial = field("example", {
          type,
          required: false,
          readOnly: false,
          multiline: false,
          options: ["One", "Two"],
          style: { isTransparent: false },
        });
        const store = createTestEditorStore({
          fields: [initial],
          past: [],
          future: [],
        });
        const readValue = (value: FormField) =>
          property === "isTransparent"
            ? value.style?.isTransparent
            : value[property];
        try {
          await act(async () =>
            root.render(
              <Properties
                data={initial}
                onChange={(patch) =>
                  store.getState().updateField(initial.id, patch)
                }
                onTriggerHistorySave={() => store.getState().saveCheckpoint()}
              />,
            ),
          );
          const labelKey =
            property === "readOnly"
              ? "readonly"
              : property === "isTransparent"
                ? "transparent"
                : property;
          const label = [...host.querySelectorAll("label")].find(
            (element) => element.textContent === `properties.${labelKey}`,
          )!;
          const control = document.getElementById(label.htmlFor)!;
          await act(async () => {
            control.focus();
            const target = activation === "label" ? label : control;
            if (activation !== "keyboard") {
              target.dispatchEvent(
                new MouseEvent("mousedown", { bubbles: true, button: 0 }),
              );
              // Starting or canceling a press must not add an empty undo step.
              expect(store.getState().past).toHaveLength(0);
              target.dispatchEvent(
                new MouseEvent("mouseup", { bubbles: true, button: 0 }),
              );
            }
            // Keyboard activation emits click without a preceding mouse press.
            target.click();
          });
          expect(readValue(store.getState().fields[0])).toBe(true);
          expect(store.getState().past).toHaveLength(1);
          store.getState().undo();
          expect(readValue(store.getState().fields[0])).toBe(false);
          store.getState().redo();
          expect(readValue(store.getState().fields[0])).toBe(true);
        } finally {
          store.dispose();
        }
      },
    );
  },
);

it("saves one undo checkpoint for vertical alignment and restores the legacy default", async () => {
  const initial = field("text", { type: FieldType.TEXT });
  const store = createTestEditorStore({
    fields: [initial],
    past: [],
    future: [],
  });
  try {
    await act(async () =>
      root.render(
        <TextProperties
          data={initial}
          onChange={(patch) => store.getState().updateField(initial.id, patch)}
          onTriggerHistorySave={() => store.getState().saveCheckpoint()}
        />,
      ),
    );
    const button = host.querySelector<HTMLButtonElement>(
      '[aria-label="properties.vertical_alignment_options.bottom"]',
    )!;
    await act(async () => button.click());
    expect(store.getState().fields[0].verticalAlignment).toBe("bottom");
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().fields[0].verticalAlignment).toBeUndefined();
    store.getState().redo();
    expect(store.getState().fields[0].verticalAlignment).toBe("bottom");
  } finally {
    store.dispose();
  }
});
