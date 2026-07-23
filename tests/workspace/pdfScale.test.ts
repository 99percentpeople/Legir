import { describe, expect, it } from "vitest";

import { DEFAULT_SCALE, MAX_EDITOR_SCALE, MIN_EDITOR_SCALE } from "@/constants";
import {
  PDF_TO_CSS_UNITS,
  pdfViewerScaleToWorkspaceScale,
  workspaceScaleToPdfViewerScale,
  workspaceScaleToZoomPercent,
} from "@/lib/pdfScale";

describe("PDF.js-compatible zoom scale", () => {
  it("converts PDF points from 72 DPI to CSS pixels at 96 DPI", () => {
    expect(PDF_TO_CSS_UNITS).toBeCloseTo(4 / 3);
    expect(pdfViewerScaleToWorkspaceScale(1)).toBe(DEFAULT_SCALE);
    expect(workspaceScaleToPdfViewerScale(DEFAULT_SCALE)).toBeCloseTo(1);
  });

  it("reports workspace scale using PDF.js percentage semantics", () => {
    expect(workspaceScaleToZoomPercent(DEFAULT_SCALE)).toBe(100);
    expect(workspaceScaleToZoomPercent(1)).toBe(75);
  });

  it("keeps the editor range at 25% through 500%", () => {
    expect(workspaceScaleToZoomPercent(MIN_EDITOR_SCALE)).toBe(25);
    expect(workspaceScaleToZoomPercent(MAX_EDITOR_SCALE)).toBe(500);
  });
});
