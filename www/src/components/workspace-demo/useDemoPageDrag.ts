import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DropAnimationFunction,
  DragDropManager,
} from "@dnd-kit/dom";
import { demoRect } from "./displayGeometry";
import { createDemoMotion } from "./demoMotion";
import {
  moveDemoPages,
  type DemoAction,
  type DemoPage,
  type DemoState,
} from "./types";

type DragPreview = {
  source: string;
  ids: string[];
  pages: DemoPage[];
  preview: DemoPage[];
  beforeIndex: number | null;
};

/** Like the app's page grid: preview order during drag, commit one undo step. */
export function useDemoPageDrag(
  grid: RefObject<HTMLDivElement | null>,
  state: DemoState,
  dispatch: Dispatch<DemoAction>,
  managerRef?: RefObject<DragDropManager | null>,
) {
  const [drag, setDrag] = useState<DragPreview | null>(null);
  const current = useRef<DragPreview | null>(null);
  const [dropping, setDropping] = useState<string[]>([]);
  const positions = useRef<Map<string, DOMRect> | null>(null);
  const reorderMotion = useRef<AbortController | null>(null);
  const dropMotion = useRef<AbortController | null>(null);
  const takeover = useRef<AbortController | null>(null);
  const displayed = drag?.pages === state.pages ? drag.preview : state.pages;
  const moving = drag?.ids ?? dropping;

  const capture = () => {
    positions.current = new Map(
      [
        ...(grid.current?.querySelectorAll<HTMLElement>("[data-page-card]") ??
          []),
      ].map((card) => [
        card.dataset.pageCard!,
        demoRect(
          card.querySelector<HTMLElement>("[data-demo-page-card-content]") ??
            card,
        ),
      ]),
    );
    reorderMotion.current?.abort();
  };

  useLayoutEffect(() => {
    const before = positions.current;
    positions.current = null;
    if (!before) return;
    const abort = new AbortController();
    reorderMotion.current = abort;
    const motion = createDemoMotion(abort.signal);
    for (const card of grid.current?.querySelectorAll<HTMLElement>(
      "[data-page-card]",
    ) ?? []) {
      const old = before.get(card.dataset.pageCard!);
      if (!old || moving.includes(card.dataset.pageCard!)) continue;
      // Keep collision targets at their final slots. Only their contents slide;
      // otherwise a passing card can steal the drop target and reverse a move.
      const content =
        card.querySelector<HTMLElement>("[data-demo-page-card-content]") ??
        card;
      const next = demoRect(content);
      if (Math.hypot(old.x - next.x, old.y - next.y) < 1) continue;
      void motion
        .animate(
          content,
          [
            {
              transform: `translate(${old.x - next.x}px, ${old.y - next.y}px)`,
            },
            { transform: "translate(0, 0)" },
          ],
          200,
          "ease-out",
        )
        .catch((error) => {
          if (!abort.signal.aborted) throw error;
        });
    }
  }, [displayed, grid, moving]);

  useLayoutEffect(() => {
    if (!dropping.length)
      grid.current?.removeAttribute("data-page-drop-complete");
  }, [dropping, grid]);

  useEffect(
    () => () => {
      reorderMotion.current?.abort();
      dropMotion.current?.abort();
      takeover.current?.abort();
    },
    [],
  );

  function onDragStart(event: DragStartEvent) {
    const source = String(event.operation.source?.id);
    if (!state.pages.some((page) => page.id === source)) return;
    const ids = state.selectedPageIds.includes(source)
      ? state.selectedPageIds
      : [source];
    current.current = {
      source,
      ids,
      pages: state.pages,
      preview: state.pages,
      beforeIndex: null,
    };
    setDrag(current.current);
    if (!state.selectedPageIds.includes(source))
      dispatch({ type: "select-pages", id: source, intent: "single" });
  }

  function onDragOver(event: DragOverEvent) {
    const value = current.current;
    const target = String(event.operation.target?.id);
    if (!value || value.pages !== state.pages || value.ids.includes(target))
      return;
    const from = value.preview.findIndex((page) => page.id === value.source);
    const to = value.preview.findIndex((page) => page.id === target);
    const original = value.pages.findIndex((page) => page.id === target);
    if (to < 0 || original < 0) return;
    const beforeIndex = original + (to > from ? 1 : 0);
    const preview = moveDemoPages(value.pages, value.ids, beforeIndex);
    if (preview.every((page, index) => page === value.preview[index])) return;
    capture();
    current.current = { ...value, preview, beforeIndex };
    setDrag(current.current);
  }

  function onDragEnd(event: DragEndEvent) {
    const value = current.current;
    capture();
    current.current = null;
    setDropping(value?.ids ?? []);
    setDrag(null);
    // The visible placeholder owns the drop position even outside the cards.
    if (
      !event.canceled &&
      value &&
      value.pages === state.pages &&
      value.beforeIndex !== null
    )
      dispatch({
        type: "move-pages",
        ids: value.ids,
        beforeIndex: value.beforeIndex,
      });
  }

  const dropAnimation = useCallback<DropAnimationFunction>(
    async ({ source, feedbackElement }) => {
      dropMotion.current?.abort();
      const abort = new AbortController();
      dropMotion.current = abort;
      const preview = feedbackElement.querySelector<HTMLElement>(
        "[data-demo-page-drag-preview]",
      );
      const target = grid.current?.querySelector<HTMLElement>(
        `[data-page-card="${source.id}"] .demo-page-handle`,
      );
      const cancel = () => abort.abort();
      // Scrolling the surrounding website also changes the slot's viewport position.
      window.addEventListener("scroll", cancel, { capture: true, once: true });
      window.addEventListener("resize", cancel, { once: true });
      try {
        if (!preview || !target) return;
        const from = preview.getBoundingClientRect(),
          to = target.getBoundingClientRect();
        await createDemoMotion(abort.signal).animate(
          preview,
          [
            { transform: "translate(0, 0) scale(1)" },
            {
              transform: `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(${to.width / from.width}, ${to.height / from.height})`,
            },
          ],
          150,
          "ease-out",
        );
      } catch (error) {
        if (!abort.signal.aborted) throw error;
      } finally {
        // dnd-kit resets the feedback position before unmounting its contents.
        if (preview) preview.style.visibility = "hidden";
        grid.current?.setAttribute("data-page-drop-complete", "");
        window.removeEventListener("scroll", cancel, true);
        window.removeEventListener("resize", cancel);
        if (dropMotion.current === abort) {
          dropMotion.current = null;
          if (grid.current) setDropping([]);
        }
      }
    },
    [grid],
  );

  function onPointerDownCapture(event: ReactPointerEvent<HTMLElement>) {
    const manager = managerRef?.current;
    // An automatic drag has no native activator. Let it cancel, then hand this
    // same physical gesture to the manager instead of requiring a second press.
    if (
      !manager?.dragOperation.status.dragging ||
      manager.dragOperation.activatorEvent
    )
      return;
    const handle = (event.target as Element).closest<HTMLElement>(
      ".demo-page-handle",
    );
    const id =
      handle?.closest<HTMLElement>("[data-page-card]")?.dataset.pageCard;
    if (!handle || !id || event.button !== 0 || !event.isPrimary) return;
    const bounds = handle.getBoundingClientRect();
    const grab = {
      x: (event.clientX - bounds.x) / bounds.width,
      y: (event.clientY - bounds.y) / bounds.height,
    };
    const initial = { x: event.clientX, y: event.clientY };
    let pointer = initial;
    let started = false;
    const nativeEvent = event.nativeEvent;
    takeover.current?.abort();
    const abort = new AbortController();
    takeover.current = abort;
    const motion = createDemoMotion(abort.signal);
    const stop = (canceled: boolean, endEvent?: Event) => {
      if (started) manager.actions.stop({ canceled, event: endEvent });
      abort.abort();
    };
    const options = { signal: abort.signal };
    window.addEventListener(
      "pointermove",
      (move) => {
        if (move.pointerId === nativeEvent.pointerId)
          pointer = { x: move.clientX, y: move.clientY };
      },
      options,
    );
    window.addEventListener(
      "pointerup",
      (up) => {
        if (up.pointerId === nativeEvent.pointerId) stop(false, up);
      },
      options,
    );
    window.addEventListener(
      "pointercancel",
      (cancel) => {
        if (cancel.pointerId === nativeEvent.pointerId) stop(true, cancel);
      },
      options,
    );
    window.addEventListener("blur", () => stop(true), options);
    window.addEventListener(
      "keydown",
      (key) => {
        if (key.key === "Escape") stop(true, key);
      },
      options,
    );
    void (async () => {
      while (
        !manager.dragOperation.status.idle ||
        Math.hypot(pointer.x - initial.x, pointer.y - initial.y) < 6
      )
        await motion.frame();
      if (!handle.isConnected) return;
      const currentBounds = handle.getBoundingClientRect();
      manager.actions.start({
        source: id,
        event: nativeEvent,
        coordinates: {
          x: currentBounds.x + grab.x * currentBounds.width,
          y: currentBounds.y + grab.y * currentBounds.height,
        },
      });
      started = true;
      while (manager.dragOperation.status.initializing) await motion.frame();
      while (manager.dragOperation.status.dragging) {
        manager.actions.move({ to: pointer });
        await motion.frame();
      }
    })()
      .catch((error) => {
        if (!abort.signal.aborted) throw error;
      })
      .finally(() => {
        if (started && !manager.dragOperation.status.idle)
          manager.actions.stop({ canceled: true });
        abort.abort();
        if (takeover.current === abort) takeover.current = null;
      });
  }

  return {
    displayed,
    moving,
    onDragStart,
    onDragOver,
    onDragEnd,
    dropAnimation,
    onPointerDownCapture,
  };
}
