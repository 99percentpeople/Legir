import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BatchControlProperties } from "@/components/properties-panel/BatchControlProperties";
import { EditorViewContext } from "@/store/useEditorView";
import { createTestEditorStore, field } from "../helpers/editorStore";
import { FieldType } from "@/types";
vi.mock("@/lib/system-fonts", async (original) => ({
  ...(await original<typeof import("@/lib/system-fonts")>()),
  getSystemFontFamilies: async () => [],
}));
let host: HTMLDivElement,
  root: Root,
  store: ReturnType<typeof createTestEditorStore>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  store = createTestEditorStore({
    mode: "form",
    fields: [
      field("a", {
        required: true,
        style: { fontSize: 12, textColor: "#ff0000" },
      }),
      field("b", {
        required: false,
        style: { fontSize: 24, textColor: "#0000ff" },
      }),
    ],
  });
  store.getState().selectControl("a");
  store.getState().selectControl("b", "toggle");
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  store.dispose();
  vi.unstubAllGlobals();
});
const render = async () =>
  act(async () =>
    root.render(
      <EditorViewContext.Provider value={store}>
        <BatchControlProperties />
      </EditorViewContext.Provider>,
    ),
  );
it("shows mixed values without choosing the first object and applies indeterminate flags once", async () => {
  await render();
  const number = host.querySelector<HTMLInputElement>(
    '[aria-label="properties.font_size"]',
  )!;
  expect(number.value).toBe("");
  expect(number.placeholder).toBe("properties.mixed_values");
  expect(host.textContent).toContain("properties.mixed_values");
  const checkbox = host.querySelector<HTMLButtonElement>(
    '[role="checkbox"][aria-checked="mixed"]',
  )!;
  expect(checkbox).not.toBeNull();
  await act(async () => checkbox.click());
  expect(store.getState().fields.map((f) => f.required)).toEqual([true, true]);
  expect(store.getState().fields.map((f) => f.style?.fontSize)).toEqual([
    12, 24,
  ]);
  expect(store.getState().past).toHaveLength(1);
});
it("shows only shared settings when form types differ", async () => {
  store.setState({
    fields: [field("a"), field("b", { type: FieldType.CHECKBOX })],
  });
  await render();
  expect(host.querySelector('[aria-label="properties.font_size"]')).toBeNull();
  expect(host.querySelector('[aria-label="properties.alignment"]')).toBeNull();
  expect(
    host.querySelector('[aria-label="properties.border_width"]'),
  ).not.toBeNull();
});
it("offers color and opacity for mixed annotations without showing form flags or text-only settings", async () => {
  store.setState({
    mode: "annotation",
    fields: [],
    annotations: [
      { id: "a", type: "highlight", pageIndex: 0, color: "#ffff00" },
      {
        id: "b",
        type: "ink",
        pageIndex: 0,
        color: "#ff0000",
        points: [
          { x: 10, y: 10 },
          { x: 20, y: 20 },
        ],
      },
    ],
  });
  store.getState().selectControl("a");
  store.getState().selectControl("b", "toggle");
  await render();
  expect(host.textContent).toContain("properties.color");
  expect(
    host.querySelector('[aria-label="properties.opacity (%)"]'),
  ).not.toBeNull();
  expect(host.querySelector('[role="checkbox"]')).toBeNull();
  expect(host.querySelector('[aria-label="properties.font_size"]')).toBeNull();
});
