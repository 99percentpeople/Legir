import { ASCIIFluidEngine, type ColorStop } from "./field/engine.js";
import { HERO_TIDE_CONFIG } from "./config";
import type { HeroBackgroundController, HeroBackgroundStatus } from "./types";

// Warm neutral ramps, not the reference demo's full-screen ocean palette.
const LIGHT_COLORS: ColorStop[] = [
  [0, "#f2eeee"],
  [0.25, "#c4b3b3"],
  [0.5, "#a18787"],
  [0.75, "#a26767"],
  [1, "#c83737"],
];
const DARK_COLORS: ColorStop[] = [
  [0, "#191717"],
  [0.25, "#514040"],
  [0.5, "#927070"],
  [0.75, "#c39393"],
  [1, "#dfa09a"],
];

/** Imperative animation stays out of React's render loop and the editor runtime. */
export function mountHeroTide(
  canvas: HTMLCanvasElement,
  onStatus: (status: HeroBackgroundStatus) => void,
): HeroBackgroundController {
  const root = document.documentElement;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const engine = new ASCIIFluidEngine(canvas, {
    theme: root.classList.contains("dark") ? "mono" : "paper",
    quality: "low",
    glyphMode: "dot",
    dotShape: "round",
    paused: true,
    seed: 197806,
    quietZone: {
      enabled: true,
      x: 0.5,
      y: 0.46,
      radiusX: 0.36,
      radiusY: 0.55,
      strength: 0.98,
    },
    config: HERO_TIDE_CONFIG,
  });
  let destroyed = false;
  let visible = false;
  let sized = false;
  let running = false;
  let lastStatus: HeroBackgroundStatus | undefined;
  let resizeFrame: number | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let visibilityObserver: IntersectionObserver | undefined;
  let themeObserver: MutationObserver | undefined;
  const events = new AbortController();
  const { signal } = events;

  const sync = () => {
    if (destroyed) return;
    const status: HeroBackgroundStatus = motion.matches
      ? "still"
      : visible && sized && !document.hidden
        ? "running"
        : "suspended";
    const shouldRun = status === "running";
    if (shouldRun !== running) {
      if (shouldRun) engine.resume();
      else engine.pause();
      running = shouldRun;
    }
    if (status !== lastStatus) {
      lastStatus = status;
      onStatus(status);
    }
  };
  const resize = () => {
    if (destroyed) return;
    const box = canvas.getBoundingClientRect();
    sized = box.width > 1 && box.height > 1;
    visible =
      sized &&
      box.bottom > 0 &&
      box.top < window.innerHeight &&
      box.right > 0 &&
      box.left < window.innerWidth;
    if (sized) {
      // High-DPI phones don't need a full-resolution decorative canvas.
      const limit = box.width < 768 ? 1 : 1.5;
      engine.resize(
        box.width,
        box.height,
        Math.min(window.devicePixelRatio || 1, limit),
      );
    }
    sync();
  };
  const scheduleResize = () => {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined;
      resize();
    });
  };
  const applyTheme = () => {
    const dark = root.classList.contains("dark");
    const background = getComputedStyle(canvas)
      .getPropertyValue("--site-bg")
      .trim();
    engine.setStyle({
      background: background || (dark ? "#0a0a0a" : "#ffffff"),
      colors: dark ? DARK_COLORS : LIGHT_COLORS,
      chars: " .,:;-+=sZ#@",
      opacity: dark ? 0.76 : 0.84,
      scaleMin: 0.55,
      scaleMax: 1.1,
      densityGain: 1.9,
      colorMotionMix: 0.08,
      sizeMotionMix: 0,
    });
  };
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    events.abort();
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
    resizeObserver?.disconnect();
    visibilityObserver?.disconnect();
    themeObserver?.disconnect();
    engine.destroy();
  };

  try {
    applyTheme();
    resize();
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleResize);
      resizeObserver.observe(canvas);
    }
    if (typeof IntersectionObserver !== "undefined") {
      visibilityObserver = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        sync();
      });
      visibilityObserver.observe(canvas);
    } else {
      // Older browsers still stop when the hero leaves the viewport.
      window.addEventListener("scroll", scheduleResize, {
        passive: true,
        signal,
      });
    }
    themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(root, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    window.addEventListener("resize", scheduleResize, {
      passive: true,
      signal,
    });
    document.addEventListener("visibilitychange", sync, { signal });
    motion.addEventListener("change", sync, { signal });
  } catch (error) {
    destroy();
    throw error;
  }

  return { destroy };
}
