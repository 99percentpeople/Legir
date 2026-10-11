export function getPageGridLayout(width: number, scale: number) {
  const available = Math.max(1, width - 32);
  const columns = Math.max(
    1,
    Math.floor((available + 16) / (Math.max(128, 160 * scale) + 16)),
  );
  const cardWidth = (available - (columns - 1) * 16) / columns;
  const dense = cardWidth < 160;
  const thumbnailHeight = Math.round(176 * scale) + 24;
  return {
    columns,
    dense,
    thumbnailHeight,
    rowHeight: thumbnailHeight + (dense ? 72 : 52),
  };
}
