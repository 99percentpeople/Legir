import React, { act, useReducer, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoMotion } from "../../www/src/components/workspace-demo/demoMotion";
import { useDemoNavigation } from "../../www/src/components/workspace-demo/useDemoNavigation";
import {
  demoReducer,
  initialDemoState,
} from "../../www/src/components/workspace-demo/types";

describe("thumbnail selection during animated navigation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let stage: HTMLDivElement;
  let navigate: (page: number) => void;

  function Harness() {
    const ref = useRef<HTMLDivElement>(null);
    const [state, dispatch] = useReducer(demoReducer, initialDemoState);
    const onScroll = useDemoNavigation(ref, state, dispatch);
    navigate = (page) => dispatch({ type: "page", page });
    return (
      <div
        ref={(element) => {
          ref.current = element;
          if (!element) return;
          stage = element;
          Object.defineProperties(element, {
            clientWidth: { configurable: true, value: 200 },
            clientHeight: { configurable: true, value: 100 },
            scrollWidth: { configurable: true, value: 200 },
            scrollHeight: { configurable: true, value: 316 },
          });
          element.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100);
        }}
        onScroll={onScroll}
        data-current-page={state.page}
      >
        {[1, 2, 3].map((page) => (
          <div
            key={page}
            data-demo-page={page}
            ref={(element) => {
              if (element)
                element.getBoundingClientRect = () =>
                  new DOMRect(
                    16,
                    16 + (page - 1) * 100 - stage.scrollTop,
                    168,
                    100,
                  );
            }}
          />
        ))}
      </div>
    );
  }

  async function scrollEvent(ms = 20) {
    await act(async () => {
      stage.dispatchEvent(new Event("scroll"));
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
    await act(async () => navigate(3));
    // Autoplay commits the destination, then animates from the old position.
    stage.scrollTop = 0;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the destination selected while passing earlier pages", async () => {
    // Include a queued scroll callback from before the animation starts.
    stage.dispatchEvent(new Event("scroll"));
    const motion = createDemoMotion(new AbortController().signal);
    const scrolling = motion.scroll(stage, 200);
    await scrollEvent(40);
    expect(stage.scrollTop).toBeLessThan(100);
    expect(stage.dataset.currentPage).toBe("3");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      await scrolling;
    });
    expect(stage.dataset.currentPage).toBe("3");
    expect(stage.dataset.demoScrolling).toBeUndefined();
    stage.scrollTop = 0;
    await scrollEvent();
    expect(stage.dataset.currentPage).toBe("1");
  });

  it("restores visible-page tracking immediately when scrolling is cancelled", async () => {
    const abort = new AbortController();
    const scrolling = createDemoMotion(abort.signal).scroll(stage, 200);
    const rejected = expect(scrolling).rejects.toMatchObject({
      name: "AbortError",
    });
    await scrollEvent(40);
    expect(stage.dataset.currentPage).toBe("3");
    await act(async () => {
      abort.abort();
      await rejected;
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(stage.dataset.demoScrolling).toBeUndefined();
    expect(stage.dataset.currentPage).toBe("1");
    stage.scrollTop = 200;
    await scrollEvent();
    expect(stage.dataset.currentPage).toBe("3");
  });
});
