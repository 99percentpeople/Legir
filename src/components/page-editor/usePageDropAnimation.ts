import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { DropAnimationFunction } from "@dnd-kit/dom";

// Only animate mounted, visible papers. Reuse their cached images; a large
// selection must not mount or render the rest of the document just to drop it.
async function animateDrop(
  feedback: Element,
  sourceId: string,
  grid: HTMLElement,
  ids: Set<string>,
  signal: AbortSignal,
) {
  const preview = feedback.querySelector<HTMLElement>(
    "[data-page-drag-overlay]",
  );
  const front = preview?.querySelector<HTMLElement>(
    "[data-page-drag-front] [data-page-thumbnail]",
  );
  if (
    !preview ||
    !front ||
    signal.aborted ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return;

  const animations: Animation[] = [];
  const cleanups: (() => void)[] = [];
  const cancel = () => animations.forEach((animation) => animation.cancel());
  signal.addEventListener("abort", cancel, { once: true });
  // A user may scroll or resize before the short drop finishes. Reveal the
  // real papers immediately instead of landing at stale viewport coordinates.
  grid.addEventListener("scroll", cancel, { once: true });
  window.addEventListener("resize", cancel, { once: true });
  try {
    // Keyboard feedback can still be in transit when Space is pressed.
    // Freeze it at its current position before measuring the individual papers.
    for (const animation of feedback.getAnimations()) {
      if (animation.playState === "running") {
        animation.pause();
        cleanups.push(() => animation.cancel());
      }
    }
    const origin = feedback.getBoundingClientRect();
    const viewport = grid.getBoundingClientRect();
    const frontRect = front.getBoundingClientRect();
    const stack = new Map(
      [...preview.querySelectorAll<HTMLElement>("[data-page-drag-stack]")].map(
        (element) => [element.dataset.pageDragStack!, element],
      ),
    );
    // Batch all geometry reads before creating or hiding any DOM nodes.
    const papers = [...grid.querySelectorAll<HTMLElement>("[data-page-card]")]
      .filter((card) => ids.has(card.dataset.pageCard!))
      .flatMap((card) => {
        const target = card.querySelector<HTMLElement>("[data-page-thumbnail]");
        if (!target) return [];
        const end = target.getBoundingClientRect();
        if (
          !end.width ||
          !end.height ||
          end.bottom <= viewport.top ||
          end.top >= viewport.bottom ||
          end.right <= viewport.left ||
          end.left >= viewport.right
        )
          return [];
        const id = card.dataset.pageCard!;
        const backing = stack.get(id);
        const paper =
          id === sourceId
            ? front
            : backing?.querySelector<HTMLElement>("[data-page-thumbnail]");
        const start = paper?.getBoundingClientRect() ?? frontRect;
        const style = paper ? getComputedStyle(paper) : null;
        const backingStyle = backing ? getComputedStyle(backing) : null;
        return [
          {
            id,
            target,
            end,
            x: start.x + start.width / 2 - end.x - end.width / 2,
            y: start.y + start.height / 2 - end.y - end.height / 2,
            scaleX: style ? parseFloat(style.width) / end.width : 1,
            scaleY: style ? parseFloat(style.height) / end.height : 1,
            rotate: backingStyle?.rotate ?? "0deg",
            visible: !!paper,
            zIndex:
              id === sourceId
                ? 3
                : backingStyle
                  ? 1 + (parseInt(backingStyle.zIndex, 10) || 0)
                  : 0,
          },
        ];
      });

    for (const paper of papers) {
      const { target, end, x, y, scaleX, scaleY, rotate } = paper;
      const clone = target.cloneNode(true) as HTMLElement;
      for (const attribute of [...clone.attributes]) {
        if (attribute.name.startsWith("data-dnd-") || attribute.name === "id")
          clone.removeAttribute(attribute.name);
      }
      clone.style.cssText = "";
      Object.assign(clone.style, {
        position: "absolute",
        left: `${end.x - origin.x}px`,
        top: `${end.y - origin.y}px`,
        width: `${end.width}px`,
        height: `${end.height}px`,
        maxWidth: "none",
        maxHeight: "none",
        margin: "0",
        borderColor: "transparent",
        boxShadow: "none",
        visibility: "visible",
        pointerEvents: "none",
        zIndex: String(paper.zIndex),
      });
      clone.dataset.pageDropPreview = paper.id;
      clone.setAttribute("aria-hidden", "true");
      const visibility = target.style.visibility;
      cleanups.push(() => {
        clone.remove();
        target.style.visibility = visibility;
      });
      feedback.append(clone);
      target.style.visibility = "hidden";
      animations.push(
        clone.animate(
          [
            {
              transform: `translate(${x}px, ${y}px) rotate(${rotate === "none" ? "0deg" : rotate}) scale(${scaleX}, ${scaleY})`,
              opacity: paper.visible ? 1 : 0,
            },
            {
              transform: "translate(0px, 0px) rotate(0deg) scale(1, 1)",
              opacity: 1,
            },
          ],
          {
            duration: ids.size === 1 ? 150 : 220,
            easing:
              ids.size === 1 ? "ease-out" : "cubic-bezier(0.2, 0, 0.2, 1)",
            fill: "both",
          },
        ),
      );
    }
    // Keep the old stack hidden until DragOverlay unmounts it. dnd-kit resets
    // its positioning before React removes its children on the following tick.
    preview.style.visibility = "hidden";
    await Promise.allSettled(animations.map((animation) => animation.finished));
  } finally {
    // React may not commit the cleared moving state until the next frame.
    // Reveal real papers at full opacity in the same paint that removes clones.
    grid.setAttribute("data-page-drop-complete", "");
    signal.removeEventListener("abort", cancel);
    grid.removeEventListener("scroll", cancel);
    window.removeEventListener("resize", cancel);
    cancel();
    cleanups.reverse().forEach((cleanup) => cleanup());
  }
}

export function usePageDropAnimation(
  gridRef: RefObject<HTMLDivElement | null>,
) {
  const [dropping, setDropping] = useState<Set<string> | null>(null);
  const idsRef = useRef<Set<string> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);
  useLayoutEffect(() => {
    if (!dropping) gridRef.current?.removeAttribute("data-page-drop-complete");
  }, [dropping, gridRef]);

  const prepareDrop = useCallback((ids: Set<string> | undefined) => {
    idsRef.current = ids?.size ? ids : null;
    setDropping(idsRef.current);
  }, []);
  const dropAnimation = useCallback<DropAnimationFunction>(
    async (context) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      try {
        if (gridRef.current && idsRef.current)
          await animateDrop(
            context.feedbackElement,
            String(context.source.id),
            gridRef.current,
            idsRef.current,
            controller.signal,
          );
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          idsRef.current = null;
          if (!controller.signal.aborted) setDropping(null);
        }
      }
    },
    [gridRef],
  );
  return { dropping, prepareDrop, dropAnimation };
}
