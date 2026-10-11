import React, { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorTabActiveContext } from "@/app/editorTabs/context";
import { useThumbnailViewport } from "@/hooks/useThumbnailViewport";
import { EditorViewContext } from "@/store/useEditorView";
import { createTestEditorStore } from "./helpers/editorStore";

class Observer {
  static instances: Observer[] = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(
    private callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit,
  ) {
    Observer.instances.push(this);
  }
  emit(entries: [Element, number][]) {
    this.callback(
      entries.map(([target, size]) => ({
        target,
        isIntersecting: size >= 0,
        intersectionRect: { width: size, height: size },
      })) as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver,
    );
  }
}

function Viewport({ ids }: { ids: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useThumbnailViewport(ref);
  return (
    <div ref={ref}>
      {ids.map((id) => (
        <div key={id} data-thumbnail-page-id={id} />
      ))}
    </div>
  );
}

beforeEach(() => {
  Observer.instances = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", Observer);
});
afterEach(() => vi.unstubAllGlobals());

it("reports only intersecting thumbnails, follows virtual rows, and removes hidden-tab priorities", async () => {
  const store = createTestEditorStore();
  const report = vi.spyOn(store.getState(), "setThumbnailViewport");
  const remove = vi.spyOn(store.getState(), "removeThumbnailViewport");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (ids: string[], active = true) =>
    act(async () =>
      root.render(
        <EditorViewContext.Provider value={store}>
          <EditorTabActiveContext.Provider value={active}>
            <Viewport ids={ids} />
          </EditorTabActiveContext.Provider>
        </EditorViewContext.Provider>,
      ),
    );
  const nodes = () => [...host.querySelectorAll("[data-thumbnail-page-id]")];
  try {
    await render(["0", "1", "2"]);
    const observer = Observer.instances[0];
    const owner = report.mock.calls[0][0];
    expect(observer.options.root).toBe(host.firstElementChild);
    expect(observer.observe).toHaveBeenCalledTimes(3);
    expect(report).toHaveBeenLastCalledWith(owner, null);
    const [a, b, c] = nodes();
    observer.emit([[a, 100]]);
    expect(report).toHaveBeenCalledTimes(1);
    // Touching the viewport boundary (zero area) isn't visible.
    observer.emit([
      [b, 0],
      [c, -1],
    ]);
    expect(report).toHaveBeenLastCalledWith(owner, ["0"]);
    observer.emit([
      [a, -1],
      [b, 80],
    ]);
    expect(report).toHaveBeenLastCalledWith(owner, ["1"]);

    await render(["1", "2", "3"]);
    const d = nodes()[2];
    expect(observer.unobserve).toHaveBeenCalledWith(a);
    expect(observer.observe).toHaveBeenCalledWith(d);
    observer.emit([
      [b, -1],
      [c, 90],
      [d, 10],
    ]);
    expect(report).toHaveBeenLastCalledWith(owner, ["2", "3"]);
    // Reordering preserves observers, and inserting an image isn't a new page.
    observer.observe.mockClear();
    observer.unobserve.mockClear();
    report.mockClear();
    await render(["3", "2", "1"]);
    c.append(document.createElement("img"));
    await act(async () => {});
    expect(observer.observe).not.toHaveBeenCalled();
    expect(observer.unobserve).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();

    await render(["3", "2", "1"], false);
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(owner);
    observer.emit([[d, -1]]);
    expect(report).not.toHaveBeenCalled();
    await render(["3", "2", "1"]);
    expect(Observer.instances).toHaveLength(2);
    expect(report.mock.lastCall?.[1]).toBeNull();
  } finally {
    await act(async () => root.unmount());
    store.dispose();
    host.remove();
  }
  expect(Observer.instances[1].disconnect).toHaveBeenCalledOnce();
});
