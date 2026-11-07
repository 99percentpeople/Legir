import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorViewContext } from "@/store/useEditorView";
import { useControlMultiSelection } from "@/components/workspace/hooks/useControlMultiSelection";
import { createTestEditorStore, field } from "../helpers/editorStore";

let host: HTMLDivElement;
let root: Root;
let store: ReturnType<typeof createTestEditorStore>;
const fields = [
  field("a"),
  field("b", { rect: { x: 200, y: 40, width: 100, height: 20 } }),
];
let scrollOffset = { x: 0, y: 0 };
const getPoint = (x: number, y: number) => ({
  x: (y + scrollOffset.y) / 2,
  y: -(x + scrollOffset.x) / 2,
});
function Probe() {
  const { preview, onPointerDownCapture } = useControlMultiSelection(
    getPoint,
    false,
  );
  return (
    <div data-preview={JSON.stringify(preview)}>
      {fields.map((control) => (
        <button
          key={control.id}
          data-id={control.id}
          onPointerDownCapture={(event) => onPointerDownCapture(event, control)}
        >
          {control.id}
        </button>
      ))}
    </div>
  );
}
const pointer = async (
  type: string,
  target: EventTarget,
  options: Record<string, unknown> = {},
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({
    button: 0,
    pointerId: 1,
    pointerType: "mouse",
    ctrlKey: false,
    metaKey: false,
    clientX: 10,
    clientY: 20,
    ...options,
  })) {
    Object.defineProperty(event, key, { value });
  }
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
};
beforeEach(async () => {
  scrollOffset = { x: 0, y: 0 };
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  store = createTestEditorStore({ mode: "form", tool: "select", fields });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <EditorViewContext.Provider value={store}>
        <Probe />
      </EditorViewContext.Provider>,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  store.dispose();
  host.remove();
  vi.unstubAllGlobals();
});
const selectGroup = () => {
  store.getState().selectControl("a");
  store.getState().selectControl("b", "toggle");
};

describe("multi-selection pointer interactions", () => {
  it.each([false, true])(
    "keeps a stationary pointer anchored while scrolling (duplicate: %s)",
    async (duplicate) => {
      selectGroup();
      await pointer("pointerdown", host.querySelector('[data-id="a"]')!, {
        ctrlKey: duplicate,
      });
      await pointer("pointermove", window, { clientX: 30, clientY: 60 });
      scrollOffset = { x: -20, y: 60 };
      await act(async () => {
        host.dispatchEvent(new Event("scroll"));
        await new Promise(requestAnimationFrame);
      });
      const preview = JSON.parse(
        host.querySelector("[data-preview]")!.getAttribute("data-preview")!,
      );
      expect(preview).toMatchObject({ x: 50, y: 0, duplicate });
      expect(store.getState().fields).toBe(fields);
      expect(store.getState().past).toHaveLength(0);
      await pointer("pointerup", window, { clientX: 30, clientY: 60 });
      const moved = duplicate
        ? store.getState().fields.slice(2)
        : store.getState().fields;
      expect(moved.map((field) => field.rect.x)).toEqual([60, 250]);
      expect(store.getState().past).toHaveLength(1);
      store.getState().undo();
      expect(store.getState().fields).toEqual(fields);
    },
  );

  it.each(["ctrlKey", "metaKey"])(
    "uses %s to toggle without editing or leaving an input focused",
    async (key) => {
      store.getState().selectControl("a");
      const input = document.createElement("input");
      host.append(input);
      input.focus();
      const event = await pointer(
        "pointerdown",
        host.querySelector('[data-id="b"]')!,
        { [key]: true },
      );
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).not.toBe(input);
      expect(store.getState().selectedControlIds).toEqual(["a"]);
      await pointer("pointerup", window, { [key]: true });
      expect(store.getState().selectedControlIds).toEqual(["a", "b"]);
      expect(store.getState().past).toHaveLength(0);
    },
  );

  it("does not turn a Ctrl-click into a copy when only the viewport scrolls", async () => {
    selectGroup();
    await pointer("pointerdown", host.querySelector('[data-id="a"]')!, {
      ctrlKey: true,
    });
    scrollOffset = { x: 0, y: 60 };
    await act(async () => {
      host.dispatchEvent(new Event("scroll"));
      await new Promise(requestAnimationFrame);
    });
    expect(
      host.querySelector("[data-preview]")?.getAttribute("data-preview"),
    ).toBe("null");
    await pointer("pointerup", window, { ctrlKey: true });
    expect(store.getState().selectedControlIds).toEqual(["b"]);
    expect(store.getState().fields).toBe(fields);
    expect(store.getState().past).toHaveLength(0);
  });

  it.each(["Escape", "release"])(
    "cleans up a queued scroll update on %s",
    async (action) => {
      selectGroup();
      await pointer("pointerdown", host.querySelector('[data-id="a"]')!);
      await pointer("pointermove", window, { clientX: 30, clientY: 60 });
      scrollOffset = { x: -20, y: 60 };
      await act(async () => {
        host.dispatchEvent(new Event("scroll"));
        if (action === "Escape")
          window.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
        else await pointer("pointerup", window, { clientX: 30, clientY: 60 });
        await new Promise(requestAnimationFrame);
      });
      expect(
        host.querySelector("[data-preview]")?.getAttribute("data-preview"),
      ).toBe("null");
      expect(store.getState().fields[0].rect.x).toBe(
        action === "Escape" ? 10 : 60,
      );
      expect(store.getState().past).toHaveLength(action === "Escape" ? 0 : 1);
      await act(async () => {
        host.dispatchEvent(new Event("scroll"));
        await new Promise(requestAnimationFrame);
      });
      expect(
        host.querySelector("[data-preview]")?.getAttribute("data-preview"),
      ).toBe("null");
    },
  );

  it.each(["ctrlKey", "metaKey"])(
    "%s-drag duplicates a single object and leaves the original untouched",
    async (key) => {
      store.getState().selectControl("a");
      await pointer("pointerdown", host.querySelector('[data-id="a"]')!, {
        [key]: true,
      });
      await pointer("pointermove", window, { clientX: 30, clientY: 60 });
      expect(store.getState().fields).toBe(fields);
      expect(
        host.querySelector("[data-preview]")?.getAttribute("data-preview"),
      ).toContain('"duplicate":true');
      await pointer("pointerup", window, { clientX: 30, clientY: 60 });
      expect(store.getState().fields).toHaveLength(3);
      expect(store.getState().fields.slice(0, 2)).toEqual(fields);
      expect(store.getState().fields[2].rect).toEqual({
        x: 30,
        y: 0,
        width: 100,
        height: 20,
      });
      expect(store.getState().selectedControlIds).toEqual([
        store.getState().fields[2].id,
      ]);
      expect(store.getState().past).toHaveLength(1);
      store.getState().undo();
      expect(store.getState().fields).toEqual(fields);
      store.getState().redo();
      expect(store.getState().fields).toHaveLength(3);
    },
  );

  it("duplicates the selected group together without toggling its pressed member off", async () => {
    selectGroup();
    await pointer("pointerdown", host.querySelector('[data-id="a"]')!, {
      ctrlKey: true,
    });
    await pointer("pointerup", window, { clientX: 30, clientY: 60 });
    expect(store.getState().fields).toHaveLength(4);
    expect(store.getState().fields.slice(0, 2)).toEqual(fields);
    expect(
      store
        .getState()
        .fields.slice(2)
        .map((field) => field.rect),
    ).toEqual([
      { x: 30, y: 0, width: 100, height: 20 },
      { x: 220, y: 30, width: 100, height: 20 },
    ]);
    expect(store.getState().selectedControlIds).toEqual(
      store
        .getState()
        .fields.slice(2)
        .map((field) => field.id),
    );
    expect(store.getState().past).toHaveLength(1);
  });

  it("Ctrl-drag on an unselected object copies that object without moving the selection", async () => {
    store.getState().selectControl("a");
    await pointer("pointerdown", host.querySelector('[data-id="b"]')!, {
      ctrlKey: true,
    });
    await pointer("pointerup", window, { clientX: 30, clientY: 60 });
    expect(store.getState().fields).toHaveLength(3);
    expect(store.getState().fields.slice(0, 2)).toEqual(fields);
    expect(store.getState().fields[2].rect.x).toBe(220);
  });

  it("a Ctrl-click with small pointer jitter only toggles selection", async () => {
    selectGroup();
    await pointer("pointerdown", host.querySelector('[data-id="a"]')!, {
      ctrlKey: true,
    });
    await pointer("pointerup", window, { clientX: 11, clientY: 21 });
    expect(store.getState().selectedControlIds).toEqual(["b"]);
    expect(store.getState().fields).toBe(fields);
    expect(store.getState().past).toHaveLength(0);
  });

  it.each(["Escape", "pointercancel", "blur"])(
    "cancels duplicate preview on %s without creating copies or changing selection",
    async (reason) => {
      selectGroup();
      await pointer("pointerdown", host.querySelector('[data-id="a"]')!, {
        ctrlKey: true,
      });
      await pointer("pointermove", window, { clientX: 30, clientY: 60 });
      if (reason === "Escape")
        await act(async () => {
          window.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
        });
      else await pointer(reason, window);
      await pointer("pointerup", window, { clientX: 30, clientY: 60 });
      expect(store.getState().fields).toBe(fields);
      expect(store.getState().selectedControlIds).toEqual(["a", "b"]);
      expect(store.getState().past).toHaveLength(0);
    },
  );

  it("previews movement in rotated/scaled PDF coordinates, then commits once", async () => {
    selectGroup();
    await pointer("pointerdown", host.querySelector('[data-id="a"]')!);
    await pointer("pointermove", window, { clientX: 30, clientY: 60 });
    expect(store.getState().fields).toBe(fields);
    expect(
      host.querySelector("[data-preview]")?.getAttribute("data-preview"),
    ).toContain('"x":20');
    await pointer("pointerup", window, { clientX: 30, clientY: 60 });
    expect(store.getState().fields.map((field) => field.rect)).toEqual([
      { x: 30, y: 0, width: 100, height: 20 },
      { x: 220, y: 30, width: 100, height: 20 },
    ]);
    expect(store.getState().past).toHaveLength(1);
    expect(store.getState().selectedControlIds).toEqual(["a", "b"]);
    store.getState().undo();
    expect(store.getState().fields).toEqual(fields);
  });

  it.each(["pointercancel", "blur", "Escape", "unmount"])(
    "cancels on %s without modifying data/history",
    async (reason) => {
      selectGroup();
      await pointer("pointerdown", host.querySelector('[data-id="a"]')!);
      await pointer("pointermove", window, { clientX: 30, clientY: 60 });
      if (reason === "Escape")
        await act(async () => {
          window.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
        });
      else if (reason === "unmount") await act(async () => root.render(null));
      else await pointer(reason, window);
      await pointer("pointerup", window, { clientX: 30, clientY: 60 });
      expect(store.getState().fields).toBe(fields);
      expect(store.getState().past).toHaveLength(0);
    },
  );

  it("ordinary click collapses a group without a history entry", async () => {
    selectGroup();
    await pointer("pointerdown", host.querySelector('[data-id="a"]')!);
    await pointer("pointerup", window);
    expect(store.getState().selectedControlIds).toEqual(["a"]);
    expect(store.getState().past).toHaveLength(0);
  });

  it("leaves form filling and touch scrolling alone", async () => {
    selectGroup();
    expect(
      (
        await pointer("pointerdown", host.querySelector('[data-id="a"]')!, {
          pointerType: "touch",
        })
      ).defaultPrevented,
    ).toBe(false);
    store.setState({ mode: "annotation" });
    expect(
      (
        await pointer("pointerdown", host.querySelector('[data-id="a"]')!, {
          ctrlKey: true,
        })
      ).defaultPrevented,
    ).toBe(false);
    expect(store.getState().selectedControlIds).toEqual([]);
  });
});
