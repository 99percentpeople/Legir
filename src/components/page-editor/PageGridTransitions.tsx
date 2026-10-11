import { Component, type ReactNode, type RefObject } from "react";
import type { PageGridLayout } from "./pageGridLayout";

type Props = {
  ids: readonly string[];
  gridRef: RefObject<HTMLDivElement | null>;
  layout: PageGridLayout;
  disabled?: boolean;
  children: ReactNode;
};
type Snapshot = {
  added: Set<string>;
  positions: Map<string, DOMRect>;
  removed: { element: HTMLElement; rect: DOMRect; opacity: string }[];
};
const contentSelector = "[data-page-card-content]";
const duration = 220;

function visible(rect: DOMRect, viewport: DOMRect) {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.right > viewport.left &&
    rect.left < viewport.right &&
    rect.bottom > viewport.top &&
    rect.top < viewport.bottom
  );
}

function resized(before: PageGridLayout, after: PageGridLayout) {
  return (
    before.gridWidth !== after.gridWidth ||
    before.thumbnailSize !== after.thumbnailSize
  );
}

function cloneContent(element: HTMLElement) {
  const clone = element.cloneNode(true) as HTMLElement;
  // Deleted pages can release their blob URLs before React commits. Preserve
  // the already decoded pixels without retaining a PDF or requesting a render.
  const images = element.querySelectorAll("img");
  clone.querySelectorAll("img").forEach((image, index) => {
    const source = images[index];
    if (!source.complete || !source.naturalWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = source.naturalWidth;
    canvas.height = source.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(source, 0, 0);
    canvas.className = image.className;
    canvas.style.cssText = image.style.cssText;
    image.replaceWith(canvas);
  });
  for (const node of [clone, ...clone.querySelectorAll("*")]) {
    node.removeAttribute("id");
    for (const attribute of [...node.attributes]) {
      if (
        attribute.name.startsWith("data-page-") ||
        attribute.name.startsWith("data-dnd-") ||
        attribute.name === "data-thumbnail-page-id" ||
        attribute.name === "data-demo-page-card-content"
      )
        node.removeAttribute(attribute.name);
    }
  }
  return clone;
}

/** Capture before React removes/repositions cards, including undo and imports.
 * Only visible content animates; sortable targets stay at their final slots. */
export class PageGridTransitions extends Component<Props> {
  private animations = new Set<Animation>();
  private frozen = new Map<
    HTMLElement,
    { transform: string; opacity: string; zIndex: string }
  >();
  private layer: HTMLDivElement | null = null;
  private pending = new Set<string>();
  private pendingUntil = 0;
  private origin: { x: number; y: number; top: number; left: number } | null =
    null;
  private media?: MediaQueryList;
  private grid: HTMLDivElement | null = null;

  private cancel = () => {
    for (const animation of this.animations) animation.cancel();
    this.animations.clear();
    this.layer?.remove();
    this.layer = null;
    this.origin = null;
  };
  finish = () => {
    this.pending.clear();
    this.cancel();
    for (const [element, style] of this.frozen)
      Object.assign(element.style, style);
    this.frozen.clear();
  };
  private prepareDrag = (event: Event) => {
    if (
      !(event.target instanceof Element) ||
      !event.target.closest("[data-page-drag-handle]")
    )
      return;
    if (event instanceof KeyboardEvent) {
      if (event.key !== " " && event.key !== "Enter") return;
    } else if ((event as PointerEvent).button !== 0) return;
    // dnd-kit measures ancestors with their animations temporarily finished.
    // Freeze the painted position as ordinary CSS until feedback is captured.
    for (const animation of this.animations) {
      const element = (animation.effect as KeyframeEffect | null)?.target;
      if (
        !(element instanceof HTMLElement) ||
        !element.matches(contentSelector)
      )
        continue;
      const style = getComputedStyle(element);
      this.frozen.set(element, {
        transform: element.style.transform,
        opacity: element.style.opacity,
        zIndex: element.style.zIndex,
      });
      Object.assign(element.style, {
        transform: style.transform,
        opacity: style.opacity,
        zIndex: style.zIndex,
      });
    }
    this.cancel();
    const grid = this.grid;
    if (grid && this.frozen.size) {
      const rect = grid.getBoundingClientRect();
      this.origin = {
        x: rect.x,
        y: rect.y,
        top: grid.scrollTop,
        left: grid.scrollLeft,
      };
    }
  };
  private releasePress = () => {
    if (this.frozen.size && !this.props.disabled) this.finish();
  };
  private onScroll = () => {
    const grid = this.grid,
      origin = this.origin;
    if (!grid || !origin || (!this.animations.size && !this.frozen.size))
      return;
    const rect = grid.getBoundingClientRect();
    // Ignore queued scroll events for the position where this motion began.
    if (
      rect.x !== origin.x ||
      rect.y !== origin.y ||
      grid.scrollTop !== origin.top ||
      grid.scrollLeft !== origin.left
    ) {
      if (this.frozen.size) this.finish();
      else this.cancel();
    }
  };

  componentDidMount() {
    this.grid = this.props.gridRef.current;
    this.media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    this.media?.addEventListener?.("change", this.finish);
    this.grid?.addEventListener("pointerdown", this.prepareDrag, true);
    this.grid?.addEventListener("keydown", this.prepareDrag, true);
    this.grid?.addEventListener("wheel", this.finish, { passive: true });
    window.addEventListener("scroll", this.onScroll, true);
    window.addEventListener("resize", this.finish);
    window.addEventListener("pointerup", this.releasePress);
    window.addEventListener("pointercancel", this.releasePress);
    window.addEventListener("keyup", this.releasePress);
  }

  getSnapshotBeforeUpdate(previous: Props): Snapshot | null {
    const { ids, disabled, layout } = this.props;
    const grid = this.grid;
    if (
      !grid ||
      disabled ||
      previous.disabled ||
      this.media?.matches ||
      !grid.animate ||
      previous.ids === ids ||
      resized(previous.layout, layout)
    )
      return null;
    const before = new Set(previous.ids),
      after = new Set(ids);
    const added = new Set(ids.filter((id) => !before.has(id)));
    if (!added.size && previous.ids.every((id) => after.has(id))) return null;
    const viewport = grid.getBoundingClientRect();
    const snapshot: Snapshot = { added, positions: new Map(), removed: [] };
    for (const card of grid.querySelectorAll<HTMLElement>("[data-page-card]")) {
      const element = card.querySelector<HTMLElement>(contentSelector);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      const id = card.dataset.pageCard!;
      snapshot.positions.set(id, rect);
      // Overscan positions let the next row slide into view without popping in.
      if (!after.has(id) && visible(rect, viewport))
        snapshot.removed.push({
          element: cloneContent(element),
          rect,
          opacity: getComputedStyle(element).opacity,
        });
    }
    return snapshot;
  }

  componentDidUpdate(
    previous: Props,
    _state: unknown,
    snapshot: Snapshot | null,
  ) {
    if (resized(previous.layout, this.props.layout)) {
      this.finish();
      return;
    }
    if (this.props.disabled) {
      // Let the drag sensor measure the visible paper before finishing motion.
      // The first drag move calls finish() once its feedback has been captured.
      this.pending.clear();
      return;
    }
    if (snapshot) {
      this.finish();
      this.pending = snapshot.added;
      // A virtual grid may mount the newly selected page after auto-scrolling.
      this.pendingUntil = performance.now() + 400;
    }
    const grid = this.grid;
    if (!grid || this.media?.matches || !grid.animate) return;
    if (performance.now() > this.pendingUntil) this.pending.clear();
    if (!snapshot && !this.pending.size) return;
    const viewport = grid.getBoundingClientRect();
    const scale = viewport.width / grid.offsetWidth || 1;
    this.origin = {
      x: viewport.x,
      y: viewport.y,
      top: grid.scrollTop,
      left: grid.scrollLeft,
    };
    // Read every destination before starting animations or appending exits.
    const cards = [
      ...grid.querySelectorAll<HTMLElement>("[data-page-card]"),
    ].flatMap((card) => {
      const element = card.querySelector<HTMLElement>(contentSelector);
      if (!element) return [];
      const rect = element.getBoundingClientRect();
      return visible(rect, viewport)
        ? [{ id: card.dataset.pageCard!, element, rect }]
        : [];
    });
    for (const { id, element, rect } of cards) {
      if (this.pending.delete(id)) {
        this.animate(element, "enter", [
          { opacity: 0, transform: "translateY(8px) scale(0.96)" },
          { opacity: 1, transform: "translateY(0) scale(1)" },
        ]);
      } else {
        const old = snapshot?.positions.get(id);
        if (!old || Math.hypot(old.x - rect.x, old.y - rect.y) < 1) continue;
        this.animate(element, "move", [
          {
            transform: `translate(${(old.x - rect.x) / scale}px, ${(old.y - rect.y) / scale}px)`,
          },
          { transform: "translate(0, 0)" },
        ]);
      }
    }
    if (!snapshot?.removed.length) return;
    const layer = document.createElement("div");
    layer.dataset.pageExits = "";
    layer.setAttribute("aria-hidden", "true");
    layer.inert = true;
    Object.assign(layer.style, {
      position: "absolute",
      left: "0",
      top: `${grid.scrollTop}px`,
      width: "100%",
      height: `${grid.clientHeight}px`,
      overflow: "clip",
      pointerEvents: "none",
      zIndex: "10",
      contain: "strict",
    });
    this.layer = layer;
    grid.append(layer);
    for (const { element, rect, opacity } of snapshot.removed) {
      Object.assign(element.style, {
        position: "absolute",
        margin: "0",
        transform: "none",
        left: `${(rect.left - viewport.left) / scale}px`,
        top: `${(rect.top - viewport.top) / scale}px`,
        width: `${rect.width / scale}px`,
        height: `${rect.height / scale}px`,
      });
      layer.append(element);
      this.animate(
        element,
        "exit",
        [
          { opacity, transform: "scale(1)" },
          { opacity: 0, transform: "scale(0.94)" },
        ],
        () => {
          element.remove();
          if (!layer.childElementCount) layer.remove();
        },
      );
    }
  }

  private animate(
    element: HTMLElement,
    kind: string,
    keyframes: Keyframe[],
    cleanup?: () => void,
  ) {
    // Moving content must remain clickable above neighboring empty grid slots.
    const animation = element.animate(
      keyframes.map((frame) => ({ ...frame, zIndex: 1 })),
      {
        duration: kind === "exit" ? 160 : duration,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "both",
      },
    );
    animation.id = `page-grid-${kind}`;
    this.animations.add(animation);
    const finish = () => {
      this.animations.delete(animation);
      animation.cancel();
      cleanup?.();
      if (!this.animations.size && !this.frozen.size) this.origin = null;
    };
    void animation.finished.then(finish, finish);
  }

  componentWillUnmount() {
    this.finish();
    this.media?.removeEventListener?.("change", this.finish);
    this.grid?.removeEventListener("pointerdown", this.prepareDrag, true);
    this.grid?.removeEventListener("keydown", this.prepareDrag, true);
    this.grid?.removeEventListener("wheel", this.finish);
    window.removeEventListener("scroll", this.onScroll, true);
    window.removeEventListener("resize", this.finish);
    window.removeEventListener("pointerup", this.releasePress);
    window.removeEventListener("pointercancel", this.releasePress);
    window.removeEventListener("keyup", this.releasePress);
  }

  render() {
    return this.props.children;
  }
}
