import {
  WORKSPACE_HEAVY_PAGE_DPR_CAP,
  WORKSPACE_HEAVY_PAGE_PIXEL_THRESHOLD,
} from "@/constants";
import {
  createViewportFromPageInfo,
  type PageViewportInfo,
} from "@/services/pdfService/lib/coords";

export const getWorkspaceViewportPixelCount = (
  pageInfo: PageViewportInfo,
  scale: number,
) => {
  const viewport = createViewportFromPageInfo(pageInfo, {
    scale,
    rotation: pageInfo.rotation,
  });
  return Math.ceil(viewport.width) * Math.ceil(viewport.height);
};

export const isHeavyWorkspacePage = (
  pageInfo: PageViewportInfo,
  scale: number,
) => {
  return (
    getWorkspaceViewportPixelCount(pageInfo, scale) >=
    WORKSPACE_HEAVY_PAGE_PIXEL_THRESHOLD
  );
};

export const getWorkspaceRenderDpr = (
  pageInfo: PageViewportInfo,
  scale: number,
  requestedDpr: number,
) => {
  if (!Number.isFinite(requestedDpr) || requestedDpr <= 0) {
    return 1;
  }

  if (isHeavyWorkspacePage(pageInfo, scale)) {
    return Math.min(requestedDpr, WORKSPACE_HEAVY_PAGE_DPR_CAP);
  }

  return requestedDpr;
};
