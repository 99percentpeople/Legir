import React, { useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/components/language-provider";
import {
  connectPDFPageRenderDebug,
  syncPDFPageRenderDebugView,
  usePDFPageRenderDebugSnapshot,
} from "./pdfPageRenderTelemetry";

interface PDFPageRenderDebugOverlayProps {
  pageIndex: number;
  scale: number;
  isInView: boolean;
  debugJustEnabled: boolean;
  textLayerEnabled: boolean;
  overlayHost?: HTMLElement | null;
}

const PDFPageRenderDebugOverlay: React.FC<PDFPageRenderDebugOverlayProps> = ({
  pageIndex,
  scale,
  isInView,
  debugJustEnabled,
  textLayerEnabled,
  overlayHost,
}) => {
  const { t } = useLanguage();
  const { renderTiming, currentReadyState } =
    usePDFPageRenderDebugSnapshot(pageIndex);

  useLayoutEffect(() => {
    return connectPDFPageRenderDebug(pageIndex);
  }, [pageIndex]);

  useLayoutEffect(() => {
    syncPDFPageRenderDebugView({
      pageIndex,
      scale,
      isInView,
      debugJustEnabled,
    });
  }, [debugJustEnabled, isInView, pageIndex, scale]);

  const totalReadyMs = (() => {
    if (!renderTiming) return null;
    const values = [
      renderTiming.canvasReadyMs,
      textLayerEnabled ? renderTiming.textReadyMs : null,
    ].filter((value): value is number => value !== null);
    if (values.length === 0) return null;
    return Math.max(...values);
  })();

  const renderStatusLabel = (() => {
    if (!renderTiming || renderTiming.kind === null) {
      if (!currentReadyState || currentReadyState.targetScale === null) {
        return t("debug_overlay.page_waiting");
      }
      const isReady =
        currentReadyState.canvasReady === true &&
        (!textLayerEnabled || currentReadyState.textReady === true);
      const isPartial =
        currentReadyState.canvasReady === true ||
        (textLayerEnabled && currentReadyState.textReady === true);

      if (isReady) return t("debug_overlay.page_current_ready");
      if (isPartial) return t("debug_overlay.page_current_partial");
      return t("debug_overlay.page_current_waiting");
    }

    const isReady =
      renderTiming.canvasReadyMs !== null &&
      (!textLayerEnabled || renderTiming.textReadyMs !== null);
    const isPartial =
      renderTiming.canvasReadyMs !== null ||
      (textLayerEnabled && renderTiming.textReadyMs !== null);

    if (renderTiming.kind === "initial") {
      if (isReady) return t("debug_overlay.page_first_ready");
      if (isPartial) return t("debug_overlay.page_first_partial");
      return t("debug_overlay.page_first_rendering");
    }

    if (isReady) return t("debug_overlay.page_zoom_ready");
    if (isPartial) return t("debug_overlay.page_zoom_partial");
    return t("debug_overlay.page_zoom_rendering");
  })();

  const displayScale =
    renderTiming?.targetScale ?? currentReadyState?.targetScale ?? null;
  const overlay =
    isInView && renderTiming ? (
      <div className="pointer-events-none absolute top-2 right-2 z-[70] rounded-md bg-black/70 px-2 py-1 font-mono text-[11px] leading-4 text-white shadow-lg">
        <div>{renderStatusLabel}</div>
        <div>
          {`${t("debug_overlay.zoom")} ${
            displayScale === null ? "--" : `${Math.round(displayScale * 100)}%`
          }`}
        </div>
        <div>{`${t("debug_overlay.canvas")} ${renderTiming.canvasReadyMs ?? "--"} ms`}</div>
        <div>
          {`${t("debug_overlay.text")} ${
            textLayerEnabled
              ? `${renderTiming.textReadyMs ?? "--"} ms`
              : t("debug_overlay.off")
          }`}
        </div>
        <div>{`${t("debug_overlay.total")} ${totalReadyMs ?? "--"} ms`}</div>
      </div>
    ) : null;

  if (!overlay) {
    return null;
  }

  return overlayHost ? createPortal(overlay, overlayHost) : overlay;
};

export default PDFPageRenderDebugOverlay;
