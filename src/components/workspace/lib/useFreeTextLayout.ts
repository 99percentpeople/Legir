import { useLayoutEffect, useMemo, useState } from "react";
import { splitTextRuns } from "@/lib/fonts";
import {
  getFreeTextBaseline,
  wrapFreeText,
} from "@/services/pdfService/lib/freeTextLayout";

let canvas: HTMLCanvasElement | undefined;
type FontMetrics = { capCenter: number; cssBaselineEm: number };
const fontMetricsCache = new Map<string, FontMetrics>();

export function useFreeTextLayout(
  text: string,
  width: number,
  fontSize: number,
  lineHeight: number,
  fontFamily: string,
  nonAsciiFontFamily: string,
  editFontFamily: string,
) {
  const [metrics, setMetrics] = useState({
    capCenter: 0.36,
    cssBaselineEm: 0.86,
  });

  useLayoutEffect(() => {
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      if (!canvas) {
        canvas = document.createElement("canvas");
        // Register before the per-control listeners: a newly loaded font must
        // invalidate fallback metrics before any control measures it again.
        document.fonts?.addEventListener("loadingdone", () =>
          fontMetricsCache.clear(),
        );
      }
      const key = JSON.stringify([fontFamily, editFontFamily]);
      const cached = fontMetricsCache.get(key);
      if (cached) {
        setMetrics(cached);
        return;
      }
      const context = canvas.getContext("2d");
      if (!context) return;
      // H gives a stable capital-height reference regardless of the entered text.
      context.font = `1000px ${fontFamily}`;
      const h = context.measureText("H");
      const capCenter =
        (h.actualBoundingBoxAscent - h.actualBoundingBoxDescent) / 2000;
      // Textareas use CSS line boxes. Measure their alphabetic baseline so typing
      // uses the same explicit baseline as the SVG overlay and PDF appearance.
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:fixed;left:-10000px;top:0;visibility:hidden;white-space:pre;font-size:1000px;line-height:1000px;padding:0;border:0;";
      probe.style.fontFamily = editFontFamily;
      probe.textContent = "H";
      const marker = document.createElement("span");
      marker.style.cssText =
        "display:inline-block;width:0;height:0;padding:0;border:0;vertical-align:baseline;";
      probe.append(marker);
      document.body.append(probe);
      const cssBaselineEm =
        (marker.getBoundingClientRect().top -
          probe.getBoundingClientRect().top) /
        1000;
      probe.remove();
      const measured = {
        capCenter: Number.isFinite(capCenter) ? capCenter : 0.36,
        cssBaselineEm,
      };
      fontMetricsCache.set(key, measured);
      setMetrics(measured);
    };
    measure();
    void document.fonts?.ready.then(measure);
    document.fonts?.addEventListener("loadingdone", measure);
    return () => {
      cancelled = true;
      document.fonts?.removeEventListener("loadingdone", measure);
    };
  }, [fontFamily, nonAsciiFontFamily, editFontFamily]);

  const lines = useMemo(() => {
    const context = canvas?.getContext("2d");
    if (!context) return [];
    return wrapFreeText(text, width, (line) =>
      splitTextRuns(line).reduce((sum, run) => {
        context.font = `${fontSize}px ${run.isAscii ? fontFamily : nonAsciiFontFamily}`;
        return sum + context.measureText(run.text).width;
      }, 0),
    );
  }, [text, width, fontSize, fontFamily, nonAsciiFontFamily, metrics]);
  const baseline = getFreeTextBaseline(fontSize, lineHeight, metrics.capCenter);
  return {
    lines,
    baseline,
    editingOffset:
      baseline - (lineHeight / 2 + (metrics.cssBaselineEm - 0.5) * fontSize),
  };
}
