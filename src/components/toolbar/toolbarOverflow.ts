// Keep the original order and remove optional items from the trailing edge.
export function getToolbarOverflowIds(
  items: { id: string; width: number; pinned?: boolean }[],
  availableWidth: number,
  moreWidth: number,
  gap: number,
  frameWidth: number,
): string[] {
  let width = items.reduce((sum, item) => sum + item.width, frameWidth);
  if (width + Math.max(0, items.length - 1) * gap <= availableWidth) return [];
  const hidden: string[] = [];
  let count = items.length;
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item.pinned) continue;
    hidden.unshift(item.id);
    width -= item.width;
    count--;
    if (width + moreWidth + count * gap <= availableWidth) break;
  }
  return hidden;
}
