import { describe, expect, it } from "vitest";

import {
  calculateWorkspaceFitScreenScale,
  calculateWorkspaceInitialScale,
} from "@/components/workspace/lib/calculateWorkspaceFitScale";
import type { PageData } from "@/types";

const page: PageData = {
  pageIndex: 0,
  width: 600,
  height: 800,
  viewBox: [0, 0, 600, 800],
  userUnit: 1,
  rotation: 0,
};

const createOptions = (viewport: { width: number; height: number }) => ({
  pages: [page],
  pageIndex: 0,
  pageLayout: "single" as const,
  pageFlow: "vertical" as const,
  viewport,
});

describe("workspace initial scale", () => {
  it("does not shrink a newly opened PDF below 100%", () => {
    const options = createOptions({ width: 500, height: 500 });

    expect(calculateWorkspaceFitScreenScale(options)).toBeLessThan(1);
    expect(calculateWorkspaceInitialScale(options)).toBe(1);
  });

  it("uses the fit-screen scale when the PDF can display above 100%", () => {
    const options = createOptions({ width: 1400, height: 1600 });
    const fitScreenScale = calculateWorkspaceFitScreenScale(options);

    expect(fitScreenScale).toBeGreaterThan(1);
    expect(calculateWorkspaceInitialScale(options)).toBe(fitScreenScale);
  });
});
