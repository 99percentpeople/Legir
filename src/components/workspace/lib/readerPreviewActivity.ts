// Canvas readback/encoding can compete with scrolling even inside a worker.
// Share one activity deadline per editor without publishing React state.
const idleAfter = new WeakMap<object, number>();
const IDLE_MS = 160;

export const deferReaderPreviews = (owner: object) => {
  idleAfter.set(owner, Date.now() + IDLE_MS);
};

export const waitForReaderPreviewIdle = (
  owner: object,
  signal: AbortSignal,
): Promise<boolean> =>
  new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (ready: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(ready);
    };
    const onAbort = () => finish(false);
    const check = () => {
      if (signal.aborted) return finish(false);
      const delay = (idleAfter.get(owner) ?? 0) - Date.now();
      if (delay <= 0) return finish(true);
      timer = setTimeout(check, delay);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    check();
  });
