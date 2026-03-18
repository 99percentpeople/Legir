import React, { useLayoutEffect } from "react";
import { createPortal } from "react-dom";
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
        return "page waiting";
      }
      const isReady =
        currentReadyState.canvasReady === true &&
        (!textLayerEnabled || currentReadyState.textReady === true);
      const isPartial =
        currentReadyState.canvasReady === true ||
        (textLayerEnabled && currentReadyState.textReady === true);

      if (isReady) return "page current ready";
      if (isPartial) return "page current partial";
      return "page current waiting";
    }

    const isReady =
      renderTiming.canvasReadyMs !== null &&
      (!textLayerEnabled || renderTiming.textReadyMs !== null);
    const isPartial =
      renderTiming.canvasReadyMs !== null ||
      (textLayerEnabled && renderTiming.textReadyMs !== null);

    if (renderTiming.kind === "initial") {
      if (isReady) return "page first ready";
      if (isPartial) return "page first partial";
      return "page first rendering";
    }

    if (isReady) return "page zoom ready";
    if (isPartial) return "page zoom partial";
    return "page zoom rendering";
  })();

  const displayScale =
    renderTiming?.targetScale ?? currentReadyState?.targetScale ?? null;
  const overlay =
    isInView && renderTiming ? (
      <div className="pointer-events-none absolute top-2 right-2 z-[70] rounded-md bg-black/70 px-2 py-1 font-mono text-[11px] leading-4 text-white shadow-lg">
        <div>{renderStatusLabel}</div>
        <div>
          {`zoom ${
            displayScale === null ? "--" : `${Math.round(displayScale * 100)}%`
          }`}
        </div>
        <div>{`canvas ${renderTiming.canvasReadyMs ?? "--"} ms`}</div>
        <div>
          {`text ${
            textLayerEnabled ? `${renderTiming.textReadyMs ?? "--"} ms` : "off"
          }`}
        </div>
        <div>{`total ${totalReadyMs ?? "--"} ms`}</div>
      </div>
    ) : null;

  if (!overlay) {
    return null;
  }

  return overlayHost ? createPortal(overlay, overlayHost) : overlay;
};

export default PDFPageRenderDebugOverlay;
