import { useLayoutEffect, type RefObject } from "react";
import { useEditorTabIsActive } from "@/app/editorTabs/context";
import { useEditorViewApi } from "@/store/useEditorView";

const itemSelector = "[data-thumbnail-page-id]";

/** Report actual visibility without geometry reads or React updates on scroll.
 * Both the sidebar and virtual page grid use the same document-owned queue. */
export function useThumbnailViewport(rootRef: RefObject<HTMLElement | null>) {
  const store = useEditorViewApi();
  const active = useEditorTabIsActive();
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !active || typeof IntersectionObserver === "undefined") return;
    const owner = Symbol();
    const { setThumbnailViewport, removeThumbnailViewport } = store.getState();
    const targets = new Map<Element, string>();
    const visible = new Set<Element>();
    const initial = new Set<Element>();
    let disposed = false;
    let reported: Set<string> | null = null;
    const report = () => {
      if (disposed || initial.size) return;
      const ids = new Set([...visible].map((target) => targets.get(target)!));
      if (
        reported?.size === ids.size &&
        [...ids].every((id) => reported!.has(id))
      )
        return;
      reported = ids;
      setThumbnailViewport(owner, [...ids]);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!targets.has(entry.target)) continue;
          initial.delete(entry.target);
          if (
            entry.isIntersecting &&
            entry.intersectionRect.width > 0 &&
            entry.intersectionRect.height > 0
          )
            visible.add(entry.target);
          else visible.delete(entry.target);
        }
        report();
      },
      // Also observe the transition from touching the edge (zero area) to
      // actually visible; isIntersecting alone is already true at the edge.
      { root, threshold: [0, 0.000001] },
    );
    const observe = (element: Element) => {
      const id = element.getAttribute("data-thumbnail-page-id");
      if (id === null || targets.has(element)) return;
      targets.set(element, id);
      observer.observe(element);
    };
    for (const element of root.querySelectorAll(itemSelector)) {
      initial.add(element);
      observe(element);
    }
    setThumbnailViewport(owner, initial.size ? null : []);
    // Virtualization adds/removes cards; image replacements need no re-scan of
    // the grid. Reordered DOM nodes retain their observation and page identity.
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (!(node instanceof Element) || root.contains(node)) continue;
          const remove = (element: Element) => {
            if (!targets.delete(element)) return;
            observer.unobserve(element);
            visible.delete(element);
            initial.delete(element);
          };
          remove(node);
          node.querySelectorAll(itemSelector).forEach(remove);
        }
        for (const node of record.addedNodes) {
          if (!(node instanceof Element) || !root.contains(node)) continue;
          observe(node);
          node.querySelectorAll(itemSelector).forEach(observe);
        }
      }
      report();
    });
    mutations.observe(root, { childList: true, subtree: true });
    return () => {
      disposed = true;
      mutations.disconnect();
      observer.disconnect();
      removeThumbnailViewport(owner);
    };
  }, [rootRef, store, active]);
}
