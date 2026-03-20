import {
  FIT_SCREEN_PADDING_X,
  FIT_SCREEN_PADDING_Y,
  FIT_WIDTH_PADDING_X,
  WORKSPACE_BASE_PAGE_GAP_PX,
} from "@/constants";
import type { PageData, PageFlowDirection, PageLayoutMode } from "@/types";

type WorkspaceViewport = {
  width: number;
  height: number;
};

type WorkspaceFitScaleOptions = {
  pageFlow: PageFlowDirection;
  pageIndex?: number;
  pageLayout: PageLayoutMode;
  pages: PageData[];
  viewport: WorkspaceViewport;
};

const clampWorkspaceScale = (scale: number) => {
  return Math.max(0.25, Math.min(5.0, Number(scale.toFixed(2))));
};

const getTargetPage = (pages: PageData[], pageIndex: number = 0) => {
  if (pages.length === 0) return null;
  const targetIndex = Math.max(0, Math.min(pageIndex, pages.length - 1));
  return pages[targetIndex] ?? null;
};

export const calculateWorkspaceFitWidthScale = ({
  pageFlow,
  pageIndex = 0,
  pageLayout,
  pages,
  viewport,
}: WorkspaceFitScaleOptions) => {
  const page = getTargetPage(pages, pageIndex);
  if (!page?.width) return 1.0;

  const availableWidth = viewport.width - FIT_WIDTH_PADDING_X;
  if (pageLayout !== "single") {
    if (pageFlow === "horizontal") {
      return clampWorkspaceScale(availableWidth / page.width);
    }

    const denominator = page.width * 2 + WORKSPACE_BASE_PAGE_GAP_PX;
    return clampWorkspaceScale(
      denominator > 0 ? availableWidth / denominator : 1.0,
    );
  }

  return clampWorkspaceScale(availableWidth / page.width);
};

export const calculateWorkspaceFitScreenScale = ({
  pageFlow,
  pageIndex = 0,
  pageLayout,
  pages,
  viewport,
}: WorkspaceFitScaleOptions) => {
  const page = getTargetPage(pages, pageIndex);
  if (!page?.width || !page.height) return 1.0;

  const availableWidth = viewport.width - FIT_SCREEN_PADDING_X;
  const availableHeight = viewport.height - FIT_SCREEN_PADDING_Y;

  const widthScale =
    pageLayout !== "single"
      ? (() => {
          if (pageFlow === "horizontal") {
            return availableWidth / page.width;
          }

          const denominator = page.width * 2 + WORKSPACE_BASE_PAGE_GAP_PX;
          return denominator > 0 ? availableWidth / denominator : 1.0;
        })()
      : availableWidth / page.width;

  const heightScale =
    pageLayout !== "single" && pageFlow === "horizontal"
      ? availableHeight / (page.height * 2 + WORKSPACE_BASE_PAGE_GAP_PX)
      : availableHeight / page.height;

  return clampWorkspaceScale(Math.min(widthScale, heightScale));
};
