import React, { useEffect, useRef } from "react";
import type { PageData, ThumbnailsLayoutMode } from "@/types";
import { ImageIcon } from "lucide-react";
import { cn } from "@/utils/cn";
import { useLanguage } from "../language-provider";
import { useEditorStore } from "@/store/useEditorStore";

interface ThumbnailItemProps {
  page: PageData;
  pageIndex: number;
  onNavigate: (pageIndex: number) => void;
  isActive?: boolean;
  scrollBehaviorRef: React.RefObject<ScrollBehavior>;
  isRestoringViewState: boolean;
}

const ThumbnailItem: React.FC<ThumbnailItemProps> = ({
  page,
  pageIndex,
  onNavigate,
  isActive,
  scrollBehaviorRef,
  isRestoringViewState,
}) => {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const thumbnailImage = useEditorStore(
    (state) => state.thumbnailImages[pageIndex],
  );

  useEffect(() => {
    if (!isActive || !ref.current) return;
    const behavior = scrollBehaviorRef.current;
    ref.current.scrollIntoView({ behavior, block: "center" });
    if (behavior === "auto" && !isRestoringViewState) {
      scrollBehaviorRef.current = "smooth";
    }
  }, [isActive, isRestoringViewState, scrollBehaviorRef]);

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
        {thumbnailImage ? (
          <img
            src={thumbnailImage}
            alt={`Page ${pageIndex + 1}`}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="bg-muted text-muted-foreground flex h-full w-full items-center justify-center">
            <ImageIcon size={20} className="opacity-20" />
          </div>
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
  onNavigate: (pageIndex: number) => void;
  currentPageIndex?: number;
  thumbnailsLayout?: ThumbnailsLayoutMode;
}

const ThumbnailsPanel: React.FC<ThumbnailsPanelProps> = ({
  pages,
  onNavigate,
  currentPageIndex,
  thumbnailsLayout,
}) => {
  const { t } = useLanguage();
  const isRestoringViewState = useEditorStore(
    (state) => !!state.pendingViewStateRestore,
  );
  const scrollBehaviorRef = useRef<ScrollBehavior>("auto");
  const lastDocKeyRef = useRef<string | null>(null);

  const docKey = (() => {
    if (!pages || pages.length === 0) return "empty";
    const first = pages[0];
    const last = pages[pages.length - 1] ?? first;
    return `${pages.length}:${first.width}:${first.height}:${first.rotation}:${last.width}:${last.height}:${last.rotation}`;
  })();

  if (docKey !== lastDocKeyRef.current) {
    lastDocKeyRef.current = docKey;
    scrollBehaviorRef.current = "auto";
  }

  useEffect(() => {
    if (isRestoringViewState) {
      scrollBehaviorRef.current = "auto";
    }
  }, [isRestoringViewState]);

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-2 pb-10">
        <div
          className={cn(
            "grid gap-4",
            thumbnailsLayout === "double" ? "grid-cols-2" : "grid-cols-1",
          )}
        >
          {pages?.map((page, idx) => (
            <ThumbnailItem
              key={idx}
              page={page}
              pageIndex={idx}
              onNavigate={onNavigate}
              isActive={idx === currentPageIndex}
              scrollBehaviorRef={scrollBehaviorRef}
              isRestoringViewState={isRestoringViewState}
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
