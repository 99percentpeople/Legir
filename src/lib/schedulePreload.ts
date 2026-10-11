/** Warm one task per idle turn, without mounting UI or blocking first paint. */
export function schedulePreload(
  tasks: readonly (() => Promise<unknown>)[],
  timeout = 800,
) {
  if (typeof window === "undefined") return () => {};
  let cancelled = false;
  let index = 0;
  let cancelPending = () => {};
  const scheduleNext = () => {
    if (cancelled || index >= tasks.length) return;
    const run = () => {
      if (cancelled) return;
      const task = tasks[index++];
      void Promise.resolve()
        .then(() => {
          if (!cancelled) return task();
        })
        .catch(() => {
          // Warming is opportunistic. The actual UI can retry a failed load.
        })
        .then(scheduleNext);
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(run, { timeout });
      cancelPending = () => window.cancelIdleCallback?.(handle);
    } else {
      const handle = window.setTimeout(run, 200);
      cancelPending = () => window.clearTimeout(handle);
    }
  };
  scheduleNext();
  return () => {
    cancelled = true;
    cancelPending();
  };
}
