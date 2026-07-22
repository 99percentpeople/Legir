import { describe, expect, it } from "vitest";
import {
  getWorkspaceRenderDpr,
  getWorkspaceRenderMetrics,
} from "@/components/workspace/lib/renderPerformance";

const standardPage = {
  viewBox: [0, 0, 600, 800] as [number, number, number, number],
  userUnit: 1,
  rotation: 0,
};

describe("workspace render metrics", () => {
  it("uses the requested device DPR for regular pages", () => {
    expect(getWorkspaceRenderDpr(standardPage, 0.5, 1)).toBe(1);
    expect(getWorkspaceRenderDpr(standardPage, 1, 2)).toBe(2);
  });

  it("aligns fractional page dimensions to the integer canvas backing store", () => {
    const fractionalPage = {
      ...standardPage,
      viewBox: [0, 0, 595.28, 841.89] as [number, number, number, number],
    };

    expect(getWorkspaceRenderMetrics(fractionalPage, 1, 2)).toEqual({
      dpr: 2,
      pixelWidth: 1190,
      pixelHeight: 1683,
      cssWidth: 595,
      cssHeight: 841.5,
    });
  });

  it("preserves the existing DPR cap for heavy pages", () => {
    const heavyPage = {
      ...standardPage,
      viewBox: [0, 0, 12000, 12000] as [number, number, number, number],
    };

    expect(getWorkspaceRenderDpr(heavyPage, 0.25, 2)).toBe(1);
  });
});
