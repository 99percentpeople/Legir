// PDF coordinates use 72 points per inch while CSS uses 96 pixels per inch.
// PDF.js applies this conversion to its public zoom value before rendering.
export const PDF_TO_CSS_UNITS = 96 / 72;

export const pdfViewerScaleToWorkspaceScale = (scale: number) =>
  scale * PDF_TO_CSS_UNITS;

export const workspaceScaleToPdfViewerScale = (scale: number) =>
  scale / PDF_TO_CSS_UNITS;

export const workspaceScaleToZoomPercent = (scale: number) =>
  Math.round(workspaceScaleToPdfViewerScale(scale) * 100);
