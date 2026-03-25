import {
  TILE_MAX_DIM,
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

const WORKSPACE_TILE_MEDIUM_DIM = 1536;
const WORKSPACE_TILE_SMALL_DIM = 1024;
const WORKSPACE_TILE_MEDIUM_EDGE_THRESHOLD = 8000;
const WORKSPACE_TILE_SMALL_EDGE_THRESHOLD = 12000;
const WORKSPACE_TILE_MEDIUM_PIXEL_THRESHOLD = 24_000_000;
const WORKSPACE_TILE_SMALL_PIXEL_THRESHOLD = 48_000_000;

export const getWorkspaceTileMaxDim = (
  pageWidth: number,
  pageHeight: number,
) => {
  const pixelCount = Math.max(0, Math.ceil(pageWidth) * Math.ceil(pageHeight));
  const maxEdge = Math.max(pageWidth, pageHeight);

  if (
    pixelCount >= WORKSPACE_TILE_SMALL_PIXEL_THRESHOLD ||
    maxEdge >= WORKSPACE_TILE_SMALL_EDGE_THRESHOLD
  ) {
    return WORKSPACE_TILE_SMALL_DIM;
  }

  if (
    pixelCount >= WORKSPACE_TILE_MEDIUM_PIXEL_THRESHOLD ||
    maxEdge >= WORKSPACE_TILE_MEDIUM_EDGE_THRESHOLD
  ) {
    return WORKSPACE_TILE_MEDIUM_DIM;
  }

  return TILE_MAX_DIM;
};
