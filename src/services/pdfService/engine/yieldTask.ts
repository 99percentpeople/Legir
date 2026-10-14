/** Let worker messages (especially cancellation) run without nested-timer
 * clamping. Call only while holding the document command's exclusive lease. */
export const yieldPdfTask = () =>
  new Promise<void>((resolve) => {
    if (typeof MessageChannel === "undefined") {
      setTimeout(resolve, 0);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
