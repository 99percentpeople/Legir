import { preload } from "@/utils/preload";
import { preloadGlobalAiController } from "@/app/ai/GlobalAiContext";

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
    preloadGlobalAiController(),
  ]);
};
