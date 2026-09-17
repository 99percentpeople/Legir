import { preload } from "@/utils/preload";

type WindowWithIdleCallback = Window &
  typeof globalThis & {
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout?: number },
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

export const EditorRightPanel = preload(() =>
  import("./EditorRightPanel").then((module) => ({
    default: module.EditorRightPanel,
  })),
);

export const EditorAiRightPanel = preload(() => import("./EditorAiRightPanel"));

export const EditorPageTranslateRightPanel = preload(
  () => import("./EditorPageTranslateRightPanel"),
);

/** Warm secondary right-panel tabs without mounting them. */
export const preloadEditorRightPanelBranches = async () => {
  await Promise.allSettled([
    EditorAiRightPanel.preload(),
    EditorPageTranslateRightPanel.preload(),
  ]);
};

/**
 * Keep the initial editor path responsive, then warm secondary right-panel
 * tabs while the browser is idle. The timeout prevents very busy pages from
 * postponing the preload indefinitely.
 */
export const scheduleEditorRightPanelBranchPreload = (timeout = 800) => {
  if (typeof window === "undefined") return () => {};

  const browserWindow = window as WindowWithIdleCallback;
  let cancelled = false;
  const runPreload = () => {
    if (cancelled) return;
    void preloadEditorRightPanelBranches();
  };

  if (typeof browserWindow.requestIdleCallback === "function") {
    const handle = browserWindow.requestIdleCallback(runPreload, { timeout });
    return () => {
      cancelled = true;
      browserWindow.cancelIdleCallback?.(handle);
    };
  }

  const handle = window.setTimeout(runPreload, 200);
  return () => {
    cancelled = true;
    window.clearTimeout(handle);
  };
};
