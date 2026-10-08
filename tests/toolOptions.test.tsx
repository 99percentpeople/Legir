import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorTabActiveContext } from "@/app/editorTabs/context";
import FloatingBar from "@/components/toolbar/FloatingBar";
import { EditorToolSelector } from "@/components/toolbar/EditorToolSelector";
import { ToolPicker } from "@/components/toolbar/ToolPicker";
import { ColorPickerPopover } from "@/components/toolbar/ColorPickerPopover";
import {
  ShapeBorderStyleSection,
  ShapeDashDensityControl,
} from "@/components/toolbar/ShapeBorderStyleSection";
import { TOOL_DEFINITIONS } from "@/components/toolbar/toolDefinitions";
import { ANNOTATION_STYLES } from "@/constants";
import { appEventBus } from "@/lib/eventBus";
import type { Tool } from "@/types";
import { createTestEditorStore } from "./helpers/editorStore";

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
  appEventBus.clear();
  vi.unstubAllGlobals();
});

function setup() {
  const store = createTestEditorStore();
  const commands = {
    changeTool: vi.fn(),
    exitTool: vi.fn(),
    changeMode: vi.fn(),
    changePenStyle: vi.fn(),
    changeHighlightStyle: vi.fn(),
    changeCommentStyle: vi.fn(),
    changeFreetextStyle: vi.fn(),
    changeShapeStyle: vi.fn(),
    changeStampStyle: vi.fn(),
  };
  const render = async (tool: Tool, isMobile = false, active = true) =>
    act(async () =>
      root.render(
        <EditorTabActiveContext.Provider value={active}>
          <FloatingBar
            state={{ ...store.getState(), tool }}
            commands={commands}
            isMobile={isMobile}
            currentPageIndex={0}
            pageCount={3}
            pageLayout="single"
            pageFlow="vertical"
            isFullscreen={false}
            onNavigatePage={vi.fn()}
            onPageLayoutChange={vi.fn()}
            onPageFlowChange={vi.fn()}
            onToggleFullscreen={vi.fn()}
          />
        </EditorTabActiveContext.Provider>,
      ),
    );
  return { store, commands, render };
}
const button = (label: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const click = async (label: string) => act(async () => button(label).click());
const openMenu = async (label: string) =>
  act(async () =>
    button(label).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
const chooseBorder = async (style: "solid" | "dashed") =>
  act(async () => {
    const item = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ).find((el) => el.textContent === `properties.${style}`)!;
    item.click();
  });
function expectTopPreview() {
  const popup = document.querySelector('[data-slot="popover-content"]')!;
  const previews = popup.querySelectorAll('[role="img"][data-stroke-preview]');
  expect(previews).toHaveLength(1);
  for (const control of popup.querySelectorAll(
    'button, input, [role="slider"]',
  )) {
    expect(
      previews[0].compareDocumentPosition(control) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
}

describe("unified floating toolbar", () => {
  it.each([true, false])(
    "keeps separators between groups without a leading separator (shapesOnly=%s)",
    async (shapesOnly) => {
      const store = createTestEditorStore();
      await act(async () =>
        root.render(
          <ToolPicker
            state={{
              ...store.getState(),
              tool: "draw_shape_rect",
              mode: "annotation",
            }}
            shapesOnly={shapesOnly}
            onToolChange={vi.fn()}
          />,
        ),
      );
      await openMenu("toolbar.square");
      const group = document.querySelector(
        '[data-slot="dropdown-menu-radio-group"]',
      )!;
      const separator = '[data-slot="dropdown-menu-separator"]';
      expect(group.firstElementChild?.matches(separator)).toBe(false);
      expect(group.lastElementChild?.matches(separator)).toBe(false);
      expect(group.querySelectorAll(separator)).toHaveLength(
        shapesOnly ? 2 : 4,
      );
      expect(
        group.querySelectorAll('[data-slot="dropdown-menu-label"]'),
      ).toHaveLength(3);
    },
  );

  it.each([false, true])(
    "shows one icon-only exit for every non-default tool (mobile=%s)",
    async (mobile) => {
      const test = setup();
      for (const tool of Object.keys(TOOL_DEFINITIONS) as Tool[]) {
        await test.render(tool, mobile);
        const exit = button("toolbar.exit_tool");
        if (tool === (mobile ? "pan" : "select")) {
          expect(exit).toBeNull();
          continue;
        }
        expect(exit).not.toBeNull();
        expect(exit.textContent).toBe("");
        expect(exit.querySelector("svg")).not.toBeNull();
        expect(
          host.querySelectorAll("[data-editor-floating-toolbar]"),
        ).toHaveLength(1);
        await click("toolbar.exit_tool");
        expect(test.commands.exitTool).toHaveBeenCalled();
      }
    },
  );

  it("exposes only the selected tool's existing style options", async () => {
    const test = setup();
    for (const tool of Object.keys(TOOL_DEFINITIONS) as Tool[]) {
      await test.render(tool);
      const style = TOOL_DEFINITIONS[tool].style;
      expect(!!button("properties.color")).toBe(
        ["pen", "highlight", "comment", "freetext", "shape"].includes(style),
      );
      expect(!!button("properties.thickness")).toBe(
        ["pen", "highlight", "shape"].includes(style),
      );
      expect(!!button("properties.opacity")).toBe(
        ["pen", "highlight", "shape"].includes(style),
      );
      expect(!!button("properties.border_style")).toBe(style === "shape");
      expect(!!button("toolbar.stamp_properties")).toBe(style === "stamp");
    }
  });

  it("closes options on workspace interaction, tool change and tab deactivation", async () => {
    const test = setup();
    await test.render("draw_ink");
    await click("properties.thickness");
    expect(
      document.querySelector('[data-slot="popover-content"]'),
    ).not.toBeNull();
    expect(document.querySelector("input")?.getAttribute("aria-label")).toBe(
      "properties.thickness",
    );
    expect(document.querySelector('[role="slider"]')).toBeNull();
    await act(async () => appEventBus.emit("workspace:pointerDown", {}));
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    await click("properties.thickness");
    await test.render("draw_comment");
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    await test.render("draw_ink");
    await click("properties.thickness");
    await test.render("draw_ink", false, false);
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    await test.render("draw_ink");
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
  });

  it.each([
    ["draw_ink", "penStyle", "changePenStyle", "round"],
    ["draw_highlight", "highlightStyle", "changeHighlightStyle", "butt"],
    ["draw_shape_rect", "shapeStyle", "changeShapeStyle", "butt"],
  ] as const)(
    "previews %s live and offers width presets instead of a slider",
    async (tool, key, command, linecap) => {
      const test = setup();
      test.store.setState({
        [key]: {
          ...test.store.getState()[key],
          color: "#ff0000",
          thickness: 3,
          opacity: 0.6,
        },
      });
      await test.render(tool);
      const preview = button("properties.thickness").querySelector(
        "[data-stroke-preview] path",
      )!;
      expect(preview.getAttribute("stroke")).toBe("#ff0000");
      expect(preview.getAttribute("stroke-width")).toBe("3");
      expect(preview.getAttribute("opacity")).toBe("0.6");
      expect(preview.getAttribute("stroke-linecap")).toBe(linecap);
      expect(preview.getAttribute("d")).toBe(
        tool === "draw_highlight"
          ? "M 6 14 Q 15 9.5, 24 14 T 42 14"
          : tool === "draw_shape_rect"
            ? "M 12 14 H 36"
            : "M 12 14 Q 18 8, 24 14 T 36 14",
      );
      await click("properties.thickness");
      expect(
        document.querySelector(
          '[role="img"][aria-label="properties.stroke_preview"]',
        ),
      ).not.toBeNull();
      expect(
        document.querySelectorAll(
          '[role="group"][aria-label="properties.thickness"] button',
        ),
      ).toHaveLength(6);
      expect(document.querySelector('[role="slider"]')).toBeNull();
      expect(
        document.querySelector('input[aria-label="properties.thickness"]'),
      ).not.toBeNull();
      const width = key === "highlightStyle" ? 4 : key === "shapeStyle" ? 0 : 5;
      await click(`properties.thickness ${width} px`);
      expect(test.commands[command]).toHaveBeenLastCalledWith({
        thickness: width,
      });
      test.store.setState({
        [key]: {
          ...test.store.getState()[key],
          color: "#0000ff",
          thickness: width,
          opacity: 0.8,
        },
      });
      await test.render(tool);
      expect(preview.getAttribute("stroke")).toBe("#0000ff");
      expect(preview.getAttribute("stroke-width")).toBe(String(width));
      expect(preview.getAttribute("opacity")).toBe("0.8");
      expect(
        button(`properties.thickness ${width} px`).getAttribute("aria-pressed"),
      ).toBe("true");
    },
  );

  it.each(["color", "opacity", "thickness"])(
    "uses gentle highlight curves in the %s panel and all width presets",
    async (option) => {
      const test = setup();
      test.store.setState({
        highlightStyle: { color: "#ffff00", opacity: 0.51, thickness: 12 },
      });
      await test.render("draw_highlight");
      await click(`properties.${option}`);
      expectTopPreview();
      const large = document.querySelector(
        '[role="img"][data-stroke-preview] path',
      )!;
      expect(large.getAttribute("d")).toBe("M 16 32 Q 63 10, 110 32 T 204 32");
      expect(large.getAttribute("stroke-linecap")).toBe("butt");
      expect(large.getAttribute("opacity")).toBe("0.51");
      expect(large.getAttribute("stroke-width")).toBe("12");
      if (option === "thickness") {
        const samples = Array.from(
          document.querySelectorAll(
            '[role="group"][aria-label="properties.thickness"] [data-stroke-preview] path',
          ),
        );
        expect(
          samples.map((path) => path.getAttribute("stroke-width")),
        ).toEqual(["2", "4", "8", "12", "16", "20"]);
        for (const path of samples) {
          expect(path.getAttribute("d")).toBe("M 6 14 Q 15 9.5, 24 14 T 42 14");
          expect(path.getAttribute("stroke-linecap")).toBe("butt");
        }
      }
    },
  );

  it.each(["color", "opacity", "thickness"])(
    "keeps one stroke preview above the controls in the %s popover",
    async (option) => {
      const test = setup();
      await test.render("draw_ink");
      await click(`properties.${option}`);
      expect(
        document.querySelector(
          '[role="img"][aria-label="properties.stroke_preview"]',
        ),
      ).not.toBeNull();
      expectTopPreview();
      if (option === "opacity") {
        expect(
          document.querySelector(
            '[role="slider"][aria-label="properties.opacity"]',
          ),
        ).not.toBeNull();
      }
    },
  );

  it("accepts a precise width without a slider and ignores empty numeric input", async () => {
    const test = setup();
    await test.render("draw_ink");
    await click("properties.thickness");
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="properties.thickness"]',
    )!;
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    const enter = async (value: string) => {
      await act(async () => {
        input.focus();
        setValue.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () =>
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            bubbles: true,
          }),
        ),
      );
    };
    await enter("3.5");
    expect(test.commands.changePenStyle).toHaveBeenLastCalledWith({
      thickness: 3.5,
    });
    expect(document.activeElement).toBe(input);
    test.commands.changePenStyle.mockClear();
    await enter("");
    expect(test.commands.changePenStyle).not.toHaveBeenCalled();
    expect(test.commands.exitTool).not.toHaveBeenCalled();
  });

  it("switches shape borders with one dropdown and only shows density for dashed strokes", async () => {
    const test = setup();
    await test.render("draw_shape_rect");
    expect(
      button("properties.border_style")
        .querySelector("path")
        ?.getAttribute("stroke-dasharray"),
    ).toBeNull();
    expect(button("properties.dash_density")).toBeNull();
    expect(document.querySelector('[role="combobox"]')).toBeNull();
    await openMenu("properties.border_style");
    expect(document.querySelectorAll('[role="menuitemradio"]')).toHaveLength(2);
    expect(
      document.querySelector('[role="menuitemradio"][aria-checked="true"]')
        ?.textContent,
    ).toBe("properties.solid");
    await chooseBorder("dashed");
    expect(test.commands.changeShapeStyle).toHaveBeenLastCalledWith({
      borderStyle: "dashed",
    });
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    test.store.setState({
      shapeStyle: {
        ...(test.store.getState().shapeStyle ?? ANNOTATION_STYLES.shape),
        borderStyle: "dashed",
        dashDensity: 1.5,
      },
    });
    await test.render("draw_shape_rect");
    expect(
      button("properties.border_style")
        .querySelector("path")
        ?.getAttribute("stroke-dasharray"),
    ).toBeTruthy();
    expect(
      button("properties.thickness")
        .querySelector("path")
        ?.getAttribute("stroke-dasharray"),
    ).toBeTruthy();
    await click("properties.dash_density");
    expect(
      document
        .querySelector('[role="slider"][aria-label="properties.dash_density"]')
        ?.getAttribute("aria-valuenow"),
    ).toBe("1.5");
    expectTopPreview();
  });

  it("uses the same width controls for selected annotations and checkpoints before changing", async () => {
    const onStart = vi.fn();
    const onWidth = vi.fn();
    await act(async () =>
      root.render(
        <ColorPickerPopover
          color="#123456"
          thickness={2}
          onColorChange={vi.fn()}
          onThicknessChange={onWidth}
          onInteractionStart={onStart}
          showOpacity={false}
        >
          <button aria-label="annotation-properties">Properties</button>
        </ColorPickerPopover>,
      ),
    );
    await click("annotation-properties");
    expectTopPreview();
    await click("properties.thickness 3 px");
    await click("properties.thickness 5 px");
    expect(onStart).toHaveBeenCalledOnce();
    expect(onWidth).toHaveBeenLastCalledWith(5);
    expect(onStart.mock.invocationCallOrder[0]).toBeLessThan(
      onWidth.mock.invocationCallOrder[0],
    );
    expect(document.querySelector('[role="slider"]')).toBeNull();
  });

  it("uses the same border dropdown in annotation properties and checkpoints before changing", async () => {
    const onStart = vi.fn();
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        <ShapeBorderStyleSection
          value="solid"
          onChange={onChange}
          onInteractionStart={onStart}
        />,
      ),
    );
    expect(document.querySelector('[role="combobox"]')).toBeNull();
    await openMenu("properties.border_style");
    await chooseBorder("solid");
    expect(onStart).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    await openMenu("properties.border_style");
    await chooseBorder("dashed");
    expect(onChange).toHaveBeenCalledWith("dashed");
    expect(onStart.mock.invocationCallOrder[0]).toBeLessThan(
      onChange.mock.invocationCallOrder[0],
    );
  });

  it("checkpoints density before keyboard changes instead of after them", async () => {
    const onStart = vi.fn();
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        <ShapeDashDensityControl
          value={1}
          onChange={onChange}
          onInteractionStart={onStart}
        />,
      ),
    );
    const slider = document.querySelector('[role="slider"]')!;
    await act(async () =>
      slider.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          code: "ArrowRight",
          bubbles: true,
        }),
      ),
    );
    expect(onChange).toHaveBeenCalledWith(1.1);
    expect(onStart).toHaveBeenCalledOnce();
    expect(onStart.mock.invocationCallOrder[0]).toBeLessThan(
      onChange.mock.invocationCallOrder[0],
    );
  });

  it("keeps draft cancel and finish separate from exiting the tool", async () => {
    const test = setup();
    await test.render("draw_shape_polygon");
    await act(async () =>
      appEventBus.emit(
        "workspace:shapeDraftStateChange",
        { active: true, tool: "draw_shape_polygon", canFinish: false },
        { sticky: true },
      ),
    );
    expect(button("common.actions.done").disabled).toBe(true);
    const cancel = vi.fn();
    appEventBus.on("workspace:cancelShapeDraft", cancel);
    await click("toolbar.cancel_drawing");
    expect(cancel).toHaveBeenCalledOnce();
    expect(test.commands.exitTool).not.toHaveBeenCalled();
    await act(async () =>
      appEventBus.emit("workspace:shapeDraftStateChange", {
        active: true,
        tool: "draw_shape_polygon",
        canFinish: true,
      }),
    );
    const finish = vi.fn();
    appEventBus.on("workspace:finishShapeDraft", finish);
    await click("common.actions.done");
    expect(finish).toHaveBeenCalledOnce();
    await click("toolbar.exit_tool");
    expect(test.commands.exitTool).toHaveBeenCalledOnce();
  });

  it("keeps the desktop selector free of option dropdowns in both modes", async () => {
    const store = createTestEditorStore();
    for (const mode of ["annotation", "form"] as const) {
      await act(async () =>
        root.render(
          <EditorToolSelector
            state={{ ...store.getState(), mode }}
            onToolChange={vi.fn()}
          />,
        ),
      );
      expect(
        host.querySelector(
          '[data-slot="popover-trigger"], [data-slot="dropdown-menu-trigger"]',
        ),
      ).toBeNull();
      expect(host.querySelectorAll("button").length).toBeGreaterThan(5);
    }
  });
});
