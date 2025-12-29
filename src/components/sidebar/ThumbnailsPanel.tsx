import React, { useState, useEffect, useRef } from "react";
import { PageData } from "../../types";
import { ImageIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import { useLanguage } from "../language-provider";
import { pdfWorkerService } from "../../services/pdfService/pdfWorkerService";
import type { PDFDocumentProxy } from "pdfjs-dist";

// --- Thumbnail Item ---
interface ThumbnailItemProps {
  page: PageData;
  pageIndex: number;
  pdfDocument: PDFDocumentProxy;
  onNavigate: (pageIndex: number) => void;
  isActive?: boolean;
}

const ThumbnailItem: React.FC<ThumbnailItemProps> = ({
  page,
  pageIndex,
  pdfDocument,
  onNavigate,
  isActive,
}) => {
  const { t } = useLanguage();
  const [isRendered, setIsRendered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isTransferred = useRef(false);

  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isActive]);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (
      isVisible &&
      !isRendered &&
      pdfDocument &&
      canvasRef.current &&
      !isTransferred.current
    ) {
      const canvas = canvasRef.current;
      try {
        if (canvas.transferControlToOffscreen) {
          const offscreen = canvas.transferControlToOffscreen();
          isTransferred.current = true;
          const canvasId = `thumbnail-${pageIndex}`;

          pdfWorkerService
            .renderPage({
              pageIndex,
              scale: 0.6,
              canvas: offscreen,
              canvasId,
              priority: 10,
            })
            .then(() => {
              setIsRendered(true);
            })
            .catch((err) => {
              console.error("Thumbnail render error:", err);
            });
        }
      } catch (e) {
        console.error("Failed to render thumbnail", e);
      }
    }
  }, [isVisible, isRendered, pdfDocument, pageIndex]);

  const aspectRatio =
    page.width && page.height ? page.width / page.height : 0.75;

  return (
    <div
      ref={ref}
      className={cn(
        "hover:bg-accent/50 group flex cursor-pointer flex-col items-center gap-2 rounded-md p-2 transition-colors",
        isActive && "bg-accent",
      )}
      onClick={() => onNavigate(pageIndex)}
    >
      <div
        className={cn(
          "group-hover:ring-primary/20 relative w-full overflow-hidden rounded-sm border bg-white shadow-sm transition-all group-hover:shadow-md group-hover:ring-2",
          isActive && "ring-primary shadow-md ring-2",
        )}
        style={{ aspectRatio: aspectRatio }}
      >
        <canvas
          ref={canvasRef}
          className={cn(
            "h-full w-full object-contain",
            !isRendered && "hidden",
          )}
        />
        {!isRendered && (
          <>
            {page.imageData ? (
              <img
                src={page.imageData}
                alt={`Page ${pageIndex + 1}`}
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="bg-muted text-muted-foreground flex h-full w-full items-center justify-center">
                <ImageIcon size={20} className="opacity-20" />
              </div>
            )}
          </>
        )}
        <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/5" />
      </div>
      <span className="text-muted-foreground text-xs font-medium">
        {t("sidebar.page", { page: pageIndex + 1 })}
      </span>
    </div>
  );
};

interface ThumbnailsPanelProps {
  pages?: PageData[];
  pdfDocument?: PDFDocumentProxy;
  onNavigate: (pageIndex: number) => void;
  currentPageIndex?: number;
  pageLayout?: "single" | "double";
}

const ThumbnailsPanel: React.FC<ThumbnailsPanelProps> = ({
  pages,
  pdfDocument,
  onNavigate,
  currentPageIndex,
  pageLayout,
}) => {
  const { t } = useLanguage();

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-2 pb-10">
        <div
          className={cn(
            "grid gap-4",
            pageLayout === "double" ? "grid-cols-2" : "grid-cols-1",
          )}
        >
          {pages?.map((page, idx) => (
            <ThumbnailItem
              key={idx}
              page={page}
              pageIndex={idx}
              pdfDocument={pdfDocument}
              onNavigate={onNavigate}
              isActive={idx === currentPageIndex}
            />
          ))}
          {(!pages || pages.length === 0) && (
            <div className="text-muted-foreground p-6 text-center text-sm italic">
              {t("sidebar.no_pages")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ThumbnailsPanel;
