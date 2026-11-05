export function touch(
  target: Element,
  identifier: number,
  clientX: number,
  clientY: number,
) {
  return {
    target,
    identifier,
    clientX,
    clientY,
    pageX: clientX,
    pageY: clientY,
    screenX: clientX,
    screenY: clientY,
    radiusX: 1,
    radiusY: 1,
    rotationAngle: 0,
    force: 1,
  } satisfies Touch;
}

export function dispatchTouches(
  target: Element,
  type: string,
  touches: Touch[],
  changed = touches,
) {
  const list = (items: Touch[]) =>
    Object.assign([...items], {
      item: (index: number) => items[index] ?? null,
    });
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { value: list(touches) },
    changedTouches: { value: list(changed) },
  });
  target.dispatchEvent(event);
  return event;
}
