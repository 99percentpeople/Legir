import type { CSSProperties } from "react";

export function getPageGridLayout(width: number, scale: number) {
  const padding = 16 * scale;
  const gap = 8 * scale;
  const cardPadding = 8 * scale;
  const cardGap = 4 * scale;
  const available = Math.max(1, width - padding * 2);
  // Keep the four action buttons usable even at the smallest thumbnail scale.
  const minCardWidth = Math.max(112 + cardPadding * 2, 160 * scale);
  // Keep empty column tracks so short documents use the same spacing as full rows.
  const columns = Math.max(
    1,
    Math.floor((available + gap) / (minCardWidth + gap)),
  );
  const cardWidth = Math.min(minCardWidth, available);
  const gridWidth = available;
  // Match CSS space-around for wheel anchoring and file-drop hit testing.
  const distributedSpace = Math.max(
    0,
    (gridWidth - columns * cardWidth - (columns - 1) * gap) / columns,
  );
  const columnGap = gap + distributedSpace;
  const offset = padding + distributedSpace / 2;
  const dense = cardWidth < 160;
  // Scale the square itself, independently of spare space or column changes.
  const thumbnailSize = Math.max(
    1,
    Math.min(144 * scale, cardWidth - cardPadding * 2),
  );
  const footerHeight = dense ? 44 + cardGap : 28;
  return {
    columns,
    dense,
    padding,
    gap,
    columnGap,
    cardWidth,
    gridWidth,
    offset,
    cardPadding,
    thumbnailSize,
    rowHeight: thumbnailSize + 24 * scale + footerHeight,
    style: {
      "--page-paper-size": `${thumbnailSize}px`,
      "--page-paper-padding": `${12 * scale}px`,
      "--page-card-padding": `${cardPadding}px`,
      "--page-card-padding-bottom": `${12 * scale}px`,
      "--page-card-gap": `${cardGap}px`,
      "--page-footer-height": `${footerHeight}px`,
    } as CSSProperties,
  };
}

export type PageGridLayout = ReturnType<typeof getPageGridLayout>;
