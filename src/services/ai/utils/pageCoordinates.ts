export const AI_PAGE_COORDINATE_CONVENTION =
  "All AI-facing geometry uses editor page-space coordinates, not native PDF bottom-left coordinates: the origin is at the top-left of the page, x increases to the right, y increases downward, and width/height stay positive in page units.";

export const formatAiPageCoordinateBounds = (
  pageWidth: number,
  pageHeight: number,
) =>
  `Page coordinate space: x in [0, ${pageWidth}], y in [0, ${pageHeight}], origin at the top-left. Use editor page-space coordinates, not native PDF bottom-left coordinates.`;
