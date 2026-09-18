import { useEffect, useRef, useState } from "react";
import type { HeroBackgroundController, HeroBackgroundStatus } from "./types";
import "./hero-background.css";

/** A decorative hero layer, deliberately separate from the PDF workspace demo. */
export function HeroTidalBackground() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<HeroBackgroundController | null>(null);
  const [status, setStatus] = useState<HeroBackgroundStatus>("loading");

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (connection?.saveData) {
      setStatus("fallback");
      return;
    }
    let disposed = false;
    let scheduled = false;
    let idleId: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observer: IntersectionObserver | undefined;
    const load = async () => {
      if (disposed) return;
      try {
        const { mountHeroTide } = await import("./runtime");
        if (disposed) return;
        controller.current = mountHeroTide(element, setStatus);
      } catch {
        // The heading and links never depend on Canvas or this optional chunk.
        if (!disposed) setStatus("fallback");
      }
    };
    const schedule = () => {
      if (disposed || scheduled || document.hidden) return;
      const box = element.getBoundingClientRect();
      if (box.bottom <= 0 || box.top >= window.innerHeight) return;
      scheduled = true;
      observer?.disconnect();
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(() => void load(), {
          timeout: 1200,
        });
      } else {
        timer = setTimeout(() => void load(), 180);
      }
    };
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) schedule();
      });
      observer.observe(element);
    } else {
      window.addEventListener("scroll", schedule, { passive: true });
      schedule();
    }
    document.addEventListener("visibilitychange", schedule);
    return () => {
      disposed = true;
      observer?.disconnect();
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("scroll", schedule);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      if (timer !== undefined) clearTimeout(timer);
      controller.current?.destroy();
      controller.current = null;
    };
  }, []);

  const ready = status !== "loading" && status !== "fallback";
  return (
    <div
      className="hero-tidal-background"
      data-status={status}
      data-ready={ready}
      aria-hidden="true"
    >
      <div className="hero-tidal-visual" aria-hidden="true">
        <canvas ref={canvas} className="hero-tidal-canvas" />
      </div>
    </div>
  );
}
