/** Convert viewport measurements to the scaled demo's own CSS coordinates. */
export function demoDisplayScale(element: HTMLElement): number {
  const host = element.closest<HTMLElement>(".demo-editor");
  if (!host?.offsetWidth) return 1;
  return host.getBoundingClientRect().width / host.offsetWidth || 1;
}

export function demoRect(element: HTMLElement): DOMRect {
  const rect = element.getBoundingClientRect();
  const scale = demoDisplayScale(element);
  return new DOMRect(
    rect.x / scale,
    rect.y / scale,
    rect.width / scale,
    rect.height / scale,
  );
}
