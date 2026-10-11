import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDemoAutoplay } from "../../www/src/components/workspace-demo/useDemoAutoplay";
import { getDemoCopy } from "../../www/src/components/workspace-demo/copy";
import type { PreviewMode } from "../../www/src/content/types";
import { PREVIEW_MODES } from "../../www/src/content/types";
import {
  demoReducer,
  initialDemoState,
} from "../../www/src/components/workspace-demo/types";

describe("automatic workspace demo lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  let intersect: IntersectionObserverCallback;
  const dispatch = vi.fn();
  const chat = vi.fn();
  const next = vi.fn();
  function Harness({
    mode = "forms",
    enabled = true,
  }: {
    mode?: PreviewMode;
    enabled?: boolean;
  }) {
    const host = useRef<HTMLDivElement>(null);
    const playback = useDemoAutoplay({
      host,
      mode,
      enabled,
      copy: getDemoCopy("en"),
      dispatch,
      onChat: chat,
      onNext: next,
    });
    return (
      <div ref={host} className="demo-editor">
        <span className="demo-playback-cursor" ref={playback.cursorRef} />
        <div className="demo-editor-body">
          <button className="demo-thumbnail">1</button>
          <button className="demo-thumbnail">2</button>
          <button className="demo-thumbnail">3</button>
          <input id="demo-name" />
        </div>
      </div>
    );
  }
  async function visible(value: boolean) {
    await act(async () =>
      intersect(
        [
          {
            isIntersecting: value,
            intersectionRatio: value ? 1 : 0,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      ),
    );
  }
  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersect = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    dispatch.mockClear();
    chat.mockClear();
    next.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("starts only in view and cancels pending typing when paused", async () => {
    await advance(10000);
    expect(dispatch).not.toHaveBeenCalled();
    await visible(true);
    await advance(1700);
    expect(dispatch).toHaveBeenCalledWith({
      type: "field",
      field: "name",
      value: "Alex",
    });
    await act(async () => root.render(<Harness enabled={false} />));
    dispatch.mockClear();
    await advance(20000);
    expect(dispatch).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(chat).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "stop" }),
    );
  });
  it("discards the previous scene's timers when switching presets", async () => {
    await visible(true);
    await advance(1500);
    dispatch.mockClear();
    await act(async () => root.render(<Harness mode="pages" />));
    await advance(1800);
    expect(dispatch).toHaveBeenCalledWith({ type: "scene", mode: "pages" });
    expect(
      dispatch.mock.calls.some(([action]) => action.type === "field"),
    ).toBe(false);
    await visible(false);
    dispatch.mockClear();
    await advance(20000);
    expect(dispatch).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
  it("advances to the next preset after completing a visible scene", async () => {
    await act(async () => root.render(<Harness mode="read" />));
    await visible(true);
    await advance(9000);
    expect(dispatch).toHaveBeenCalledWith({ type: "page", page: 3 });
    expect(next).toHaveBeenCalledExactlyOnceWith("annotate");
  });

  function show(element: HTMLElement) {
    vi.spyOn(element, "getClientRects").mockReturnValue([
      new DOMRect(100, 120, 80, 40),
    ] as unknown as DOMRectList);
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 120, 80, 40),
    );
  }

  function holdCursor() {
    const cursor = container.querySelector<HTMLElement>(
      ".demo-playback-cursor",
    )!;
    let finish!: () => void;
    let reject!: (error: unknown) => void;
    const finished = new Promise<void>((resolve, fail) => {
      finish = resolve;
      reject = fail;
    });
    const cancel = vi.fn(() =>
      reject(new DOMException("Stopped", "AbortError")),
    );
    cursor.animate = vi.fn(
      () => ({ finished, cancel }) as unknown as Animation,
    );
    return { cursor, finish, cancel };
  }

  it("waits for cursor arrival before pressing and running an action", async () => {
    await act(async () => root.render(<Harness mode="read" />));
    show(container.querySelectorAll<HTMLButtonElement>(".demo-thumbnail")[1]);
    const { cursor, finish } = holdCursor();
    await visible(true);
    await advance(3000);
    expect(cursor.animate).toHaveBeenCalledOnce();
    expect(cursor.dataset.pressed).not.toBe("true");
    expect(dispatch.mock.calls.some(([action]) => action.type === "page")).toBe(
      false,
    );
    await act(async () => finish());
    await advance(250);
    expect(dispatch).toHaveBeenCalledWith({ type: "page", page: 2 });
  });

  it("cancels an in-flight cursor animation without a late click", async () => {
    await act(async () => root.render(<Harness mode="read" />));
    show(container.querySelectorAll<HTMLButtonElement>(".demo-thumbnail")[1]);
    const { cursor, cancel } = holdCursor();
    await visible(true);
    await advance(1000);
    await act(async () => root.render(<Harness mode="read" enabled={false} />));
    expect(cancel).toHaveBeenCalled();
    dispatch.mockClear();
    await advance(20000);
    expect(dispatch).not.toHaveBeenCalled();
    expect(cursor.dataset.visible).toBeUndefined();
    expect(
      container.querySelector<HTMLElement>(".demo-editor-body")!.style.opacity,
    ).toBe("");
  });

  it("releases the click before entering text", async () => {
    show(container.querySelector<HTMLInputElement>("#demo-name")!);
    await visible(true);
    await advance(1100);
    const cursor = container.querySelector<HTMLElement>(
      ".demo-playback-cursor",
    )!;
    expect(
      container.querySelector<HTMLElement>(".demo-editor")!.dataset.demoPhase,
    ).toBe("typing");
    expect(cursor.dataset.pressed).toBe("false");
    expect(cursor.dataset.kind).toBe("text");
  });
});

it.each(PREVIEW_MODES)(
  "prepares the %s scene atomically with fresh navigation",
  (mode) => {
    const previous = {
      ...initialDemoState,
      navigationToken: 10,
      highlighted: true,
    };
    const scene = demoReducer(previous, { type: "scene", mode });
    expect(scene.navigationToken).toBe(11);
    expect(scene.highlighted).toBe(false);
    expect(scene.panel).toBeNull();
    expect(scene.translationOpen).toBe(false);
    expect(scene.past).toEqual([]);
    if (mode === "forms")
      expect(scene.fields).toEqual({
        name: "",
        email: "",
        note: "",
        reviewed: false,
      });
    expect(demoReducer(scene, { type: "scene", mode }).navigationToken).toBe(
      12,
    );
  },
);
