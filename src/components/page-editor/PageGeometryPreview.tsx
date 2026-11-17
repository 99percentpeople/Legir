import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type { PageData, PageCropMargins } from "@legir/pdf-model";
import type { ThumbnailContent } from "@legir/pdf-core/types";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { getPageView } from "@/components/workspace/lib/pageViewRotation";
import { encodedImageDataUrl } from "@/utils/encodedImageDataUrl";
import { useLanguage } from "@/components/language-provider";
import { Spinner } from "@/components/ui/spinner";
import { resetGlobalCursor, setGlobalCursor } from "@/lib/cursor";

type Drag = {
  pointer: number;
  handle: "move" | (typeof handles)[number];
  startX: number;
  startY: number;
  margins: PageCropMargins;
  ratio: number;
};
type PreviewImage = {
  src: string;
  width: number;
  height: number;
  page: PageData;
  content: ThumbnailContent;
  worker: PDFWorkerService;
};
const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
const resizeCursors = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};
const previewHeight = "min(440px, 50dvh)";
export function PageGeometryPreview({
  page,
  worker,
  content,
  margins,
  onMargins,
  locked,
}: {
  page: PageData;
  worker: PDFWorkerService | null;
  content: ThumbnailContent;
  margins?: PageCropMargins;
  onMargins?: (value: PageCropMargins) => void;
  locked?: boolean;
}) {
  const { t } = useLanguage();
  const cursorSource = useId();
  const [image, setImage] = useState<PreviewImage>();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const endDrag = useCallback(() => {
    const active = drag.current;
    drag.current = null;
    resetGlobalCursor(cursorSource);
    if (active && ref.current?.hasPointerCapture(active.pointer))
      ref.current.releasePointerCapture(active.pointer);
  }, [cursorSource]);
  useEffect(() => {
    window.addEventListener("blur", endDrag);
    return () => {
      window.removeEventListener("blur", endDrag);
      endDrag();
    };
  }, [endDrag]);
  const requestedView = getPageView(page, 0);
  // The displayed paper and bitmap must always describe the same render.
  const view = image ?? requestedView;
  const imageIsCurrent =
    image?.page === page &&
    image.content === content &&
    image.worker === worker;
  const busy = loading || (!error && !imageIsCurrent);
  const frameStyle = margins
    ? {
        left: `${(margins.left / view.width) * 100}%`,
        top: `${(margins.top / view.height) * 100}%`,
        right: `${(margins.right / view.width) * 100}%`,
        bottom: `${(margins.bottom / view.height) * 100}%`,
      }
    : undefined;
  useEffect(() => {
    endDrag();
    if (!worker) return;
    const controller = new AbortController();
    setError(false);
    setLoading(true);
    const timer = setTimeout(() => {
      void worker
        .renderPageImage({
          pageIndex: page.pageIndex,
          pageGeometry: page,
          rotation: requestedView.rotation,
          targetWidth: 900,
          thumbnailContent: content,
          renderAnnotations: true,
          mimeType: "image/png",
          signal: controller.signal,
        })
        .then(async (result) => {
          if (controller.signal.aborted) return;
          if (!result.bytes.length) throw new Error("Empty preview image");
          const src = encodedImageDataUrl(result.bytes, result.mimeType);
          const decoded = new Image();
          decoded.src = src;
          await decoded.decode();
          if (controller.signal.aborted) return;
          setImage({
            src,
            width: requestedView.width,
            height: requestedView.height,
            page,
            content,
            worker,
          });
          setLoading(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setError(true);
            setLoading(false);
          }
        });
    }, 80);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    endDrag,
    worker,
    page,
    content,
    requestedView.rotation,
    requestedView.width,
    requestedView.height,
  ]);

  const start = (
    event: PointerEvent<HTMLDivElement>,
    handle: Drag["handle"],
  ) => {
    if (
      drag.current ||
      !imageIsCurrent ||
      !margins ||
      !onMargins ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const target = ref.current!;
    target.setPointerCapture(event.pointerId);
    drag.current = {
      pointer: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      margins,
      ratio:
        (view.width - margins.left - margins.right) /
        (view.height - margins.top - margins.bottom),
    };
    setGlobalCursor(
      handle === "move" ? "grabbing" : resizeCursors[handle],
      cursorSource,
    );
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer === event.pointerId) endDrag();
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current,
      bounds = ref.current?.getBoundingClientRect();
    if (
      !imageIsCurrent ||
      !d ||
      d.pointer !== event.pointerId ||
      !bounds ||
      !onMargins
    )
      return;
    const dx = ((event.clientX - d.startX) * view.width) / bounds.width;
    const dy = ((event.clientY - d.startY) * view.height) / bounds.height;
    const min = Math.min(10, view.width / 4, view.height / 4);
    const clamp = (n: number, low: number, high: number) =>
      Math.min(high, Math.max(low, n));
    let l = d.margins.left,
      r = view.width - d.margins.right;
    let top = d.margins.top,
      bottom = view.height - d.margins.bottom;
    if (d.handle === "move") {
      const x = clamp(dx, -l, view.width - r),
        y = clamp(dy, -top, view.height - bottom);
      l += x;
      r += x;
      top += y;
      bottom += y;
    } else {
      if (d.handle.includes("w")) l = clamp(l + dx, 0, r - min);
      if (d.handle.includes("e")) r = clamp(r + dx, l + min, view.width);
      if (d.handle.includes("n")) top = clamp(top + dy, 0, bottom - min);
      if (d.handle.includes("s"))
        bottom = clamp(bottom + dy, top + min, view.height);
      if (locked) {
        const anchorX = d.handle.includes("w")
          ? view.width - d.margins.right
          : d.margins.left;
        const anchorY = d.handle.includes("n")
          ? view.height - d.margins.bottom
          : d.margins.top;
        const maxW = d.handle.includes("w") ? anchorX : view.width - anchorX;
        const maxH = d.handle.includes("n") ? anchorY : view.height - anchorY;
        const desiredW =
          d.handle === "n" || d.handle === "s"
            ? (bottom - top) * d.ratio
            : r - l;
        const w = Math.min(desiredW, maxW, maxH * d.ratio),
          h = w / d.ratio;
        l = d.handle.includes("w") ? anchorX - w : anchorX;
        r = l + w;
        top = d.handle.includes("n") ? anchorY - h : anchorY;
        bottom = top + h;
      }
    }
    onMargins({
      left: l,
      right: view.width - r,
      top,
      bottom: view.height - bottom,
    });
  };
  return (
    <div className="bg-muted/60 relative flex min-h-64 min-w-0 flex-col items-center justify-center gap-3 rounded-lg border p-5">
      {busy && (
        <div className="bg-background/90 text-muted-foreground pointer-events-none absolute top-3 right-3 z-20 rounded-full p-1.5 shadow-sm">
          <Spinner aria-label={t("common.processing")} />
        </div>
      )}
      <div
        data-page-geometry-preview-stage
        className="relative w-full shrink-0"
        style={{ height: previewHeight }}
      >
        <div
          ref={ref}
          data-page-geometry-preview
          tabIndex={-1}
          role="group"
          aria-label={t("page_editor.geometry.preview")}
          aria-busy={busy}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 touch-none bg-white shadow-md outline-none select-none"
          style={{
            width: `min(100%, 480px, calc(${previewHeight} * ${view.width / view.height}))`,
            aspectRatio: view.width / view.height,
          }}
          onPointerDownCapture={(event) => {
            if (margins && onMargins && event.button === 0)
              event.currentTarget.focus({ preventScroll: true });
          }}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={finish}
        >
          {image && (
            <img
              key={image.src}
              src={image.src}
              alt={t("page_editor.geometry.preview")}
              draggable={false}
              className="absolute inset-0 h-full w-full object-contain"
            />
          )}
          {margins && onMargins && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div
                className="absolute"
                style={{
                  ...frameStyle,
                  boxShadow: "0 0 0 1000px rgb(0 0 0 / 40%)",
                }}
              />
            </div>
          )}
          {margins && onMargins && (
            <div
              data-crop-frame
              className="absolute border-2 border-blue-500"
              onPointerDown={(event) => start(event, "move")}
              style={{
                ...frameStyle,
                cursor: imageIsCurrent ? "grab" : "progress",
              }}
            >
              {handles.map((handle) => (
                <div
                  key={handle}
                  data-crop-handle={handle}
                  className="absolute z-10 h-5 w-5 touch-none"
                  style={{
                    left: handle.includes("w")
                      ? "0%"
                      : handle.includes("e")
                        ? "100%"
                        : "50%",
                    top: handle.includes("n")
                      ? "0%"
                      : handle.includes("s")
                        ? "100%"
                        : "50%",
                    transform: "translate(-50%, -50%)",
                    cursor: imageIsCurrent ? resizeCursors[handle] : "progress",
                  }}
                  onPointerDown={(event) => start(event, handle)}
                >
                  <span className="absolute inset-1.5 rounded-sm border border-blue-600 bg-white" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
        {((view.width * 25.4) / 72).toFixed(1)} ×{" "}
        {((view.height * 25.4) / 72).toFixed(1)} mm
      </span>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {t("page_editor.geometry.preview_failed")}
        </p>
      )}
    </div>
  );
}
