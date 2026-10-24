/** Text editors and modal dialogs retain native copy/paste behavior. */
export const ownsTextClipboard = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="alertdialog"]',
  );

/** Menu actions share the native-event serializers via their portable text format. */
export function createClipboardData(text = "") {
  const values = new Map([["text/plain", text]]);
  return {
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => {
      values.set(type, value);
    },
  };
}
