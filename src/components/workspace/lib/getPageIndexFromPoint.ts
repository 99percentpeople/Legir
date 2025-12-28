// Helper to find page index from mouse coordinates
export const getPageIndexFromPoint = (
  x: number,
  y: number,
  activePageIndex: number | null,
  pageCount: number,
) => {
  // Check current active page first for performance
  if (activePageIndex !== null) {
    const pageEl = document.getElementById(`page-${activePageIndex}`);
    if (pageEl) {
      const rect = pageEl.getBoundingClientRect();
      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        return activePageIndex;
      }
    }
  }

  // Check other pages
  for (let i = 0; i < pageCount; i++) {
    if (i === activePageIndex) continue;
    const pageEl = document.getElementById(`page-${i}`);
    if (pageEl) {
      const rect = pageEl.getBoundingClientRect();
      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        return i;
      }
    }
  }

  return null;
};
