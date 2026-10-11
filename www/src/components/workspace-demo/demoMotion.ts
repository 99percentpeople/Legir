const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/** One cancellable clock for cursor movement, scrolling and scene transitions. */
export function createDemoMotion(signal: AbortSignal) {
  const animations = new Set<Animation>();
  const reduced = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const cancelled = () => new DOMException("Demo stopped", "AbortError");
  const check = () => {
    if (signal.aborted) throw cancelled();
  };
  signal.addEventListener(
    "abort",
    () => {
      animations.forEach((animation) => animation.cancel());
      animations.clear();
    },
    { once: true },
  );

  function wait(ms: number): Promise<void> {
    check();
    return new Promise((resolve, reject) => {
      const stop = () => {
        clearTimeout(timer);
        reject(cancelled());
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", stop);
        resolve();
      }, ms);
      signal.addEventListener("abort", stop, { once: true });
    });
  }

  function frame(): Promise<number> {
    check();
    return new Promise((resolve, reject) => {
      const stop = () => {
        cancelAnimationFrame(id);
        reject(cancelled());
      };
      const id = requestAnimationFrame((time) => {
        signal.removeEventListener("abort", stop);
        resolve(time);
      });
      signal.addEventListener("abort", stop, { once: true });
    });
  }

  async function animate(
    element: HTMLElement,
    keyframes: Keyframe[],
    duration: number,
    easing = EASING,
  ) {
    check();
    if (reduced || !element.animate) return;
    const animation = element.animate(keyframes, {
      duration,
      easing,
      fill: "both",
    });
    animations.add(animation);
    try {
      await animation.finished;
      check();
    } finally {
      animation.cancel();
      animations.delete(animation);
    }
  }

  async function scroll(
    element: HTMLElement,
    top: number,
    left = element.scrollLeft,
  ) {
    check();
    top = Math.max(
      0,
      Math.min(top, element.scrollHeight - element.clientHeight),
    );
    left = Math.max(
      0,
      Math.min(left, element.scrollWidth - element.clientWidth),
    );
    const fromTop = element.scrollTop,
      fromLeft = element.scrollLeft;
    const distance = Math.hypot(top - fromTop, left - fromLeft);
    // Navigation already selected the destination. Intermediate scroll frames
    // must not select the pages we are passing and move the thumbnail list back.
    element.dataset.demoScrolling = "true";
    try {
      if (!reduced && distance > 1) {
        const duration = Math.min(650, 280 + distance * 0.18);
        const start = await frame();
        let progress = 0;
        while (progress < 1) {
          progress = Math.min(1, ((await frame()) - start) / duration);
          const eased = 1 - (1 - progress) ** 3;
          element.scrollTop = fromTop + (top - fromTop) * eased;
          element.scrollLeft = fromLeft + (left - fromLeft) * eased;
        }
      }
      element.scrollTop = top;
      element.scrollLeft = left;
    } finally {
      delete element.dataset.demoScrolling;
      // Also reconcile the visible page when playback stops partway through.
      element.dispatchEvent(new Event("scroll"));
    }
  }

  return { wait, frame, animate, scroll, check };
}
