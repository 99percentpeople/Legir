import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PageGridTransitions } from "@/components/page-editor/PageGridTransitions";
import { getPageGridLayout } from "@/components/page-editor/pageGridLayout";

type Motion = {
  element: HTMLElement;
  frames: Keyframe[];
  animation: Animation;
  finish: () => void;
};
let host: HTMLDivElement, root: Root;
let motions: Motion[], displayScale: number, reduced: boolean;
let transitions: PageGridTransitions | null;
const initial = ["a", "b", "c"];

function Harness({
  ids,
  rendered = ids,
  disabled = false,
  zoom = 1,
}: {
  ids: string[];
  rendered?: string[];
  disabled?: boolean;
  zoom?: number;
}) {
  const grid = useRef<HTMLDivElement>(null);
  return (
    <PageGridTransitions
      ref={(instance) => {
        transitions = instance;
      }}
      ids={ids}
      gridRef={grid}
      layout={getPageGridLayout(400, zoom)}
      disabled={disabled}
    >
      <div ref={grid} data-page-grid>
        {rendered.map((id) => (
          <div key={id} data-page-card={id}>
            <div data-page-card-content id={`content-${id}`}>
              <button data-thumbnail-page-id={id} data-page-drag-handle>
                {id}
                <img src="test.png" alt="" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </PageGridTransitions>
  );
}
const render = (props: Parameters<typeof Harness>[0]) =>
  act(() => root.render(<Harness {...props} />));
const content = (id: string) =>
  host.querySelector<HTMLElement>(`#content-${id}`)!;
const kind = (name: string) =>
  motions.filter((motion) => motion.animation.id === `page-grid-${name}`);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  motions = [];
  displayScale = 1;
  reduced = false;
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
  }));
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.matches("[data-page-grid]"))
        return new DOMRect(0, 0, 400 * displayScale, 300 * displayScale);
      const card = this.closest<HTMLElement>("[data-page-card]");
      const grid = this.closest("[data-page-grid]");
      const index =
        card && grid
          ? [...grid.querySelectorAll("[data-page-card]")].indexOf(card)
          : 0;
      return new DOMRect(
        (index % 3) * 120 * displayScale,
        Math.floor(index / 3) * 130 * displayScale,
        100 * displayScale,
        100 * displayScale,
      );
    },
  );
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(
    24,
  );
  vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(
    32,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("Animation", class {});
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: vi.fn(function (this: HTMLElement, frames: Keyframe[]) {
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const animation = {
        id: "",
        effect: { target: this },
        finished,
        cancel: vi.fn(() => finish()),
      } as unknown as Animation;
      motions.push({ element: this, frames, animation, finish });
      return animation;
    }),
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  Reflect.deleteProperty(HTMLElement.prototype, "animate");
  vi.unstubAllGlobals();
});

it("inserts immediately and moves surviving content from its pre-commit position", async () => {
  await render({ ids: initial });
  const b = content("b");
  expect(motions).toHaveLength(0);
  await render({ ids: ["a", "new", "b", "c"] });
  expect(content("b")).toBe(b);
  expect(kind("enter").map((motion) => motion.element)).toEqual([
    content("new"),
  ]);
  expect(
    kind("move").find((motion) => motion.element === b)?.frames[0].transform,
  ).toBe("translate(-120px, 0px)");
  expect(
    motions.every((motion) =>
      motion.element.hasAttribute("data-page-card-content"),
    ),
  ).toBe(true);
});

it("removes immediately while an inert copy preserves the decoded thumbnail", async () => {
  await render({ ids: initial });
  await render({ ids: ["a", "c"] });
  expect(content("b")).toBeNull();
  const layer = host.querySelector<HTMLElement>("[data-page-exits]")!;
  expect(layer.getAttribute("aria-hidden")).toBe("true");
  expect(layer.inert).toBe(true);
  expect(
    layer.querySelector(
      "[id], [data-thumbnail-page-id], [data-page-card-content]",
    ),
  ).toBeNull();
  expect(layer.querySelector("img")).toBeNull();
  expect(layer.querySelector("canvas")?.width).toBe(24);
  expect(kind("exit")).toHaveLength(1);
  await act(() => kind("exit")[0].finish());
  expect(host.querySelector("[data-page-exits]")).toBeNull();
});

it("cancels a stale exit when undo restores the page during its animation", async () => {
  await render({ ids: initial });
  await render({ ids: ["a", "c"] });
  const exit = kind("exit")[0];
  await render({ ids: initial });
  expect(exit.animation.cancel).toHaveBeenCalled();
  expect(host.querySelector("[data-page-exits]")).toBeNull();
  expect(host.querySelectorAll("#content-b")).toHaveLength(1);
  expect(kind("enter").at(-1)?.element).toBe(content("b"));
  await act(() => motions.forEach((motion) => motion.finish()));
  expect(content("b").isConnected).toBe(true);
});

it("converts viewport movement to the embedded editor's CSS scale", async () => {
  displayScale = 0.5;
  await render({ ids: initial });
  await render({ ids: ["a", "c"] });
  expect(kind("move")[0].frames[0].transform).toBe("translate(120px, 0px)");
  expect(kind("exit")[0].element.style.left).toBe("120px");
  expect(kind("exit")[0].element.style.width).toBe("100px");
});

it("freezes the painted position for drag measurement before releasing motion", async () => {
  await render({ ids: initial });
  await render({ ids: ["a", "new", "b", "c"] });
  const b = content("b");
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
    element === b
      ? ({
          transform: "matrix(1, 0, 0, 1, -75, 0)",
          opacity: "1",
          zIndex: "1",
        } as CSSStyleDeclaration)
      : computed(element),
  );
  await act(() => {
    b.querySelector("button")!.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
  });
  expect(b.style.transform).toBe("matrix(1, 0, 0, 1, -75, 0)");
  window.dispatchEvent(new Event("scroll"));
  expect(b.style.transform).toBe("matrix(1, 0, 0, 1, -75, 0)");
  expect(
    kind("move").find((motion) => motion.element === b)?.animation.cancel,
  ).toHaveBeenCalled();
  // The drag feedback now owns the visual; sortable content returns to its slot.
  transitions!.finish();
  expect(b.style.transform).toBe("");
  expect(b.style.opacity).toBe("");
  expect(b.style.zIndex).toBe("");
});

it("does not animate scrolling, zoom, or drag previews as page insertion", async () => {
  await render({ ids: initial, rendered: ["a", "b"] });
  await render({ ids: initial, rendered: ["b", "c"] });
  await render({ ids: initial, zoom: 1.5 });
  await render({ ids: [...initial, "new"], zoom: 1.5, disabled: true });
  expect(motions).toHaveLength(0);
});

it("enters a new page mounted by the virtual grid after auto-scrolling", async () => {
  await render({ ids: initial });
  const ids = [...initial, "new"];
  await render({ ids, rendered: initial });
  expect(kind("enter")).toHaveLength(0);
  await render({ ids, rendered: ["c", "new"] });
  expect(kind("enter").map((motion) => motion.element)).toEqual([
    content("new"),
  ]);
});

it("skips transitions with reduced motion and cancels them on interaction", async () => {
  reduced = true;
  await render({ ids: initial });
  await render({ ids: ["a", "c"] });
  expect(motions).toHaveLength(0);
  reduced = false;
  await render({ ids: initial });
  await render({ ids: ["a", "c"] });
  await act(() => {
    host
      .querySelector("[data-page-grid]")!
      .dispatchEvent(new Event("wheel", { bubbles: true }));
  });
  expect(
    motions.every(
      (motion) => vi.mocked(motion.animation.cancel).mock.calls.length > 0,
    ),
  ).toBe(true);
  expect(host.querySelector("[data-page-exits]")).toBeNull();
  expect(content("c").isConnected).toBe(true);
});
