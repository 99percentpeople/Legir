import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  AnnotationsPanelView,
  type AnnotationsPanelViewProps,
} from "@/components/sidebar/AnnotationsPanelView";
import { EditorTabUiContext } from "@/app/editorTabs/context";
import { EventBus, type AppEventMap } from "@/lib/eventBus";
import { selectSidebarState } from "@/store/selectors";
import { shallow } from "zustand/shallow";
import { createTestEditorStore } from "../helpers/editorStore";

const renders = vi.hoisted(() => new Map<string, number>());
vi.mock("@/components/timeText", () => ({
  TimeText: ({ time }: { time: string }) => {
    renders.set(time, (renders.get(time) ?? 0) + 1);
    return <span>{time}</span>;
  },
}));
vi.mock("@/components/language-provider", () => ({
  useLanguage: () => ({ t: (key: string) => key, effectiveLanguage: "en" }),
}));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let props: AnnotationsPanelViewProps;
let events: EventBus<AppEventMap>;
let runtime: React.ContextType<typeof EditorTabUiContext>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  events = new EventBus<AppEventMap>();
  renders.clear();
  runtime = { events, root: host, active: true };
  props = {
    annotations: Array.from({ length: 80 }, (_, i) => ({
      id: `a${i}`,
      pageIndex: 0,
      type: "comment",
      text: `Comment ${i}`,
      updatedAt: `time${i}`,
      rect: { x: 0, y: i * 20, width: 10, height: 10 },
    })),
    selectedId: "a0",
    canEditAnnotations: true,
    restrictedTitle: "Restricted",
    scrollIntoView: vi.fn(),
    onSelectControl: vi.fn(),
    onDeleteAnnotation: vi.fn(),
    onUpdateAnnotation: vi.fn(),
    onAddAnnotationReply: vi.fn(),
    onUpdateAnnotationReply: vi.fn(),
    onDeleteAnnotationReply: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = () =>
  act(async () =>
    root.render(
      <EditorTabUiContext.Provider value={runtime}>
        <AnnotationsPanelView {...props} />
      </EditorTabUiContext.Provider>,
    ),
  );
const input = async (element: HTMLTextAreaElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });

it("updates only the changed card, preserving the selected reply draft and focus", async () => {
  await render();
  const reply = host.querySelector<HTMLTextAreaElement>(
    'textarea[placeholder="sidebar.add_reply"]',
  )!;
  await input(reply, "Unsent reply");
  reply.focus();
  const before = new Map(renders);
  props = {
    ...props,
    annotations: props.annotations.map((a, i) =>
      i === 0 ? { ...a, rect: { ...a.rect!, x: 50 } } : a,
    ),
  };
  await render();
  expect(renders.get("time0")).toBeGreaterThan(before.get("time0")!);
  for (let i = 1; i < 80; i++)
    expect(renders.get(`time${i}`)).toBe(before.get(`time${i}`));
  expect(document.activeElement).toBe(reply);
  expect(reply.value).toBe("Unsent reply");
  await act(async () => {
    reply.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
      }),
    );
  });
  expect(props.onAddAnnotationReply).toHaveBeenCalledWith(
    "a0",
    expect.objectContaining({ text: "Unsent reply", parentAnnotationId: "a0" }),
  );
});

it("can focus and edit a distant card and retains permissions after memoization", async () => {
  props = { ...props, selectedId: "a79" };
  await render();
  await act(async () =>
    events.emit("sidebar:focusAnnotation", { id: "a79" }, { sticky: true }),
  );
  const editor = host.querySelector<HTMLTextAreaElement>(
    "#annotation-input-a79",
  )!;
  expect(document.activeElement).toBe(editor);
  await input(editor, "Edited comment");
  await act(async () => {
    editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
      }),
    );
  });
  expect(props.onUpdateAnnotation).toHaveBeenCalledWith("a79", {
    text: "Edited comment",
  });
  props = { ...props, canEditAnnotations: false };
  await render();
  expect(
    host.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="sidebar.add_reply"]',
    )!.disabled,
  ).toBe(true);
});

it("does not invalidate the sidebar navigation projection when controls move", () => {
  const store = createTestEditorStore({ annotations: props.annotations });
  try {
    const before = selectSidebarState(store.getState());
    store.getState().updateAnnotation("a0", {
      rect: { x: 50, y: 50, width: 10, height: 10 },
    });
    expect(shallow(before, selectSidebarState(store.getState()))).toBe(true);
  } finally {
    store.dispose();
  }
});
