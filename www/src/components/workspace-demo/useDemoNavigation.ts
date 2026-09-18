import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type RefObject,
} from "react";
import type { DemoAction, DemoState } from "./types";
import { DEMO_CANVAS_PADDING } from "./geometry";

type Anchor = { page: number; x: number; y: number };

/** Like EditorCanvasPane, distinguish scroll feedback from navigation commands.
 * Feeding every visible-page change back into scrolling makes a reader snap.
 */
export function useDemoNavigation(
  stage: RefObject<HTMLDivElement | null>,
  state: DemoState,
  dispatch: Dispatch<DemoAction>,
) {
  const frame = useRef<number | null>(null);
  const anchor = useRef<Anchor | null>(null);
  const previous = useRef<{
    token: number;
    layout: string;
    flow: string;
  } | null>(null);
  const rememberAnchor = useCallback(
    (page: number) => {
      const root = stage.current;
      const paper = root?.querySelector<HTMLElement>(
        `[data-demo-page="${page}"]`,
      );
      if (!root || !paper || !root.clientHeight) return;
      const view = root.getBoundingClientRect();
      const box = paper.getBoundingClientRect();
      if (!box.width || !box.height) return;
      anchor.current = {
        page,
        x: (view.left + root.clientWidth / 2 - box.left) / box.width,
        y: (view.top + root.clientHeight / 2 - box.top) / box.height,
      };
    },
    [stage],
  );

  useLayoutEffect(() => {
    const root = stage.current;
    if (!root || !root.clientHeight) return;
    const last = previous.current;
    const navigating =
      !last ||
      last.token !== state.navigationToken ||
      last.layout !== state.layout ||
      last.flow !== state.flow;
    const page = navigating ? state.page : (anchor.current?.page ?? state.page);
    const paper = root.querySelector<HTMLElement>(`[data-demo-page="${page}"]`);
    if (!paper) return;
    const view = root.getBoundingClientRect();
    const box = paper.getBoundingClientRect();
    if (navigating || !anchor.current) {
      root.scrollTop += box.top - view.top - DEMO_CANVAS_PADDING;
      root.scrollLeft +=
        box.left -
        view.left -
        Math.max(DEMO_CANVAS_PADDING, (root.clientWidth - box.width) / 2);
    } else {
      // Preserve the reading position when zoom or a side-panel width changes.
      root.scrollLeft +=
        box.left +
        anchor.current.x * box.width -
        view.left -
        root.clientWidth / 2;
      root.scrollTop +=
        box.top +
        anchor.current.y * box.height -
        view.top -
        root.clientHeight / 2;
    }
    previous.current = {
      token: state.navigationToken,
      layout: state.layout,
      flow: state.flow,
    };
    rememberAnchor(page);
    // Scroll feedback intentionally does not re-run navigation.
  }, [
    stage,
    state.navigationToken,
    state.zoom,
    state.layout,
    state.flow,
    rememberAnchor,
  ]);

  useLayoutEffect(() => {
    if (!state.translationOpen) return;
    const root = stage.current;
    const excerpt = root?.querySelector<HTMLElement>(
      '[data-demo-page="1"] [data-demo-excerpt="quote"]',
    );
    if (!root || !excerpt || !root.clientHeight) return;
    // Stage the fixed sample above the fixed translation card. Only the inner
    // canvas scrolls; no native selection, range measurement or page scrolling.
    root.scrollTop +=
      excerpt.getBoundingClientRect().top -
      root.getBoundingClientRect().top -
      100;
    rememberAnchor(1);
  }, [
    stage,
    state.translationOpen,
    state.translationToken,
    state.zoom,
    rememberAnchor,
  ]);

  const onScroll = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    // The translation scene always refers to page 1, even when a short viewport
    // also exposes the next sheet below the staged quote.
    if (state.translationOpen) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const root = stage.current;
      if (!root || !root.clientHeight) return;
      const view = root.getBoundingClientRect();
      const pages = [...root.querySelectorAll<HTMLElement>("[data-demo-page]")];
      const area = (element: HTMLElement) => {
        const box = element.getBoundingClientRect();
        return (
          Math.max(
            0,
            Math.min(view.right, box.right) - Math.max(view.left, box.left),
          ) *
          Math.max(
            0,
            Math.min(view.bottom, box.bottom) - Math.max(view.top, box.top),
          )
        );
      };
      let current = pages.find(
        (page) => Number(page.dataset.demoPage) === state.page,
      );
      let largestArea = current ? area(current) : 0;
      for (const page of pages) {
        const visibleArea = area(page);
        if (visibleArea > largestArea + 1) {
          current = page;
          largestArea = visibleArea;
        }
      }
      if (!current || !largestArea) return;
      const page = Number(current.dataset.demoPage);
      rememberAnchor(page);
      dispatch({ type: "visible-page", page });
    });
  }, [stage, state.page, state.translationOpen, dispatch, rememberAnchor]);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  return onScroll;
}
