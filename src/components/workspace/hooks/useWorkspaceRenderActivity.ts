import { useEffect, useRef, type RefObject } from "react";
import { useEditorTabIsActive } from "@/app/editorTabs/context";
import { useEditorViewApi } from "@/store/useEditorView";

export const useWorkspaceRenderActivity = (
  containerRef: RefObject<HTMLElement | null>,
  scale: number,
) => {
  const store = useEditorViewApi();
  const isActive = useEditorTabIsActive();
  const previousScale = useRef(scale);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isActive) return;
    const defer = () => store.getState().deferThumbnailWarmup();
    // Cancel background rasterization at input time, before zoom's deferred
    // render starts. Scroll also covers hand panning and keyboard navigation.
    const events = ["wheel", "scroll", "pointerdown", "touchmove"] as const;
    for (const event of events)
      container.addEventListener(event, defer, { passive: true });
    return () => {
      for (const event of events) container.removeEventListener(event, defer);
    };
  }, [containerRef, isActive, store]);

  useEffect(() => {
    if (previousScale.current !== scale && isActive) {
      store.getState().deferThumbnailWarmup();
    }
    previousScale.current = scale;
  }, [isActive, scale, store]);
};
