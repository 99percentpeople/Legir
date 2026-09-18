/** Scroll only the embedded sidebar, never the surrounding marketing page. */
export function scrollSidebarItem(element: HTMLElement) {
  const sidebar = element.closest(".demo-sidebar");
  if (!sidebar) return;
  for (
    let parent = element.parentElement;
    parent && sidebar.contains(parent);
    parent = parent.parentElement
  ) {
    if (!/^(auto|scroll)$/.test(getComputedStyle(parent).overflowY)) continue;
    const viewport = parent.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    if (box.top < viewport.top) parent.scrollTop += box.top - viewport.top;
    else if (box.bottom > viewport.bottom)
      parent.scrollTop += box.bottom - viewport.bottom;
    return;
  }
}
