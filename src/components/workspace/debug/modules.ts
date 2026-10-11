import { preload } from "@/utils/preload";

export const WorkspaceZoomJankOverlay = preload(
  () => import("./WorkspaceZoomJankOverlay"),
);
export const PDFPageRenderDebugOverlay = preload(
  () => import("./PDFPageRenderDebugOverlay"),
);
