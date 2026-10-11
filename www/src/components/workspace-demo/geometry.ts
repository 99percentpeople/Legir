import type { PageData, PageLayoutMode } from "@/types";
import { FIT_WIDTH_PADDING_X } from "@/constants";
import {
  PDF_TO_CSS_UNITS,
  workspaceScaleToPdfViewerScale,
} from "@/lib/pdfScale";
import {
  calculateWorkspaceFitScreenScale,
  calculateWorkspaceFitWidthScale,
} from "@/components/workspace/lib/calculateWorkspaceFitScale";
import type { DemoPage, DemoState } from "./types";

// The same A4 PDF-point dimensions as assets/workspace/reading-notes.pdf.
export const DEMO_PAGES: PageData[] = Array.from(
  { length: 3 },
  (_, pageIndex) => ({
    pageIndex,
    width: 595,
    height: 842,
    viewBox: [0, 0, 595, 842],
    userUnit: 1,
    rotation: 0,
  }),
);
export const PAPER_WIDTH = 595 * PDF_TO_CSS_UNITS;
export const PAPER_HEIGHT = 842 * PDF_TO_CSS_UNITS;
// A compact display inset rather than the full editor's 96px fit-width allowance.
export const DEMO_CANVAS_PADDING = 16;

export function demoPageGroups(layout: PageLayoutMode, count = 3): number[][] {
  // Mirrors useWorkspaceDerivedPages: even spreads keep the cover on its own.
  const groups: number[][] = [];
  for (let page = 1; page <= count; ) {
    const size =
      layout === "single" || (layout === "double_even" && page === 1) ? 1 : 2;
    groups.push(
      Array.from(
        { length: Math.min(size, count - page + 1) },
        (_, index) => page + index,
      ),
    );
    page += size;
  }
  return groups;
}

export function demoPageSize(page: DemoPage) {
  return page.rotation % 180
    ? { width: PAPER_HEIGHT, height: PAPER_WIDTH }
    : { width: PAPER_WIDTH, height: PAPER_HEIGHT };
}

export function demoDataPages(state: DemoState): PageData[] {
  return state.pages.map((page, pageIndex) => ({
    ...DEMO_PAGES[0],
    id: page.id,
    pageIndex,
    width: page.rotation % 180 ? 842 : 595,
    height: page.rotation % 180 ? 595 : 842,
  }));
}

export function demoFitZoom(
  state: DemoState,
  viewport: { width: number; height: number },
) {
  const options = {
    pages: demoDataPages(state),
    pageIndex: state.page - 1,
    pageLayout: state.layout,
    pageFlow: state.flow,
    viewport:
      state.fit === "width"
        ? {
            ...viewport,
            width:
              viewport.width + FIT_WIDTH_PADDING_X - DEMO_CANVAS_PADDING * 2,
          }
        : viewport,
  };
  const scale =
    state.fit === "width"
      ? calculateWorkspaceFitWidthScale(options)
      : calculateWorkspaceFitScreenScale(options);
  return workspaceScaleToPdfViewerScale(scale) * 100;
}
