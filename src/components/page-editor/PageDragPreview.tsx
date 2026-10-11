import { memo } from "react";
import { useLanguage } from "@/components/language-provider";
import { getPageId } from "@/services/pdfService/lib/pageStructure";
import { cn } from "@/utils/cn";
import { getPageView } from "@/components/workspace/lib/pageViewRotation";
import { PageThumbnail } from "./PageThumbnail";
import type { PageDragPreviewData } from "./types";
import type { PageData } from "@/types";
import { useEditorView } from "@/store/useEditorView";

function DragThumbnail({ page, image }: { page: PageData; image?: string }) {
  const id = getPageId(page);
  const src = useEditorView((state) => {
    if (image) return image;
    // A cold page can finish warming while it is being dragged. Read the shared
    // result rather than starting a second render just for the overlay.
    const current = state.pages[page.pageIndex];
    const index =
      current && getPageId(current) === id
        ? page.pageIndex
        : state.pages.findIndex((candidate) => getPageId(candidate) === id);
    return state.thumbnailImages[index];
  });
  return <PageThumbnail page={page} worker={null} image={src} unframed />;
}

export const PageDragPreview = memo(function PageDragPreview({
  preview,
}: {
  preview: PageDragPreviewData;
}) {
  const { t } = useLanguage();
  return (
    <div className="relative h-full w-full" data-page-drag-overlay>
      <div className="relative z-10 h-full w-full" data-page-drag-front>
        <DragThumbnail page={preview.page} image={preview.image} />
      </div>
      {preview.stack.map(({ page, image }, index) => {
        const view = getPageView(page, 0);
        const scale = preview.bounds
          ? Math.min(
              preview.bounds.width / view.width,
              preview.bounds.height / view.height,
            )
          : undefined;
        return (
          <div
            key={getPageId(page)}
            aria-hidden="true"
            data-page-drag-stack={getPageId(page)}
            className={cn(
              "absolute inset-0 flex items-center justify-center transition-[translate,rotate,opacity] duration-150 ease-out group-data-[dnd-dropping]/page-drag:translate-x-0 group-data-[dnd-dropping]/page-drag:translate-y-0 group-data-[dnd-dropping]/page-drag:rotate-0 group-data-[dnd-dropping]/page-drag:opacity-0 motion-reduce:transition-none",
              index === 0
                ? "z-1 translate-x-2 translate-y-1 rotate-3"
                : "translate-x-4 translate-y-2 rotate-6",
            )}
          >
            <div
              className="flex shrink-0 items-center justify-center"
              style={
                scale === undefined
                  ? undefined
                  : { width: view.width * scale, height: view.height * scale }
              }
            >
              <DragThumbnail page={page} image={image} />
            </div>
          </div>
        );
      })}
      {preview.count > 1 && (
        <span
          aria-label={t("page_editor.total", { count: preview.count })}
          className="bg-primary text-primary-foreground absolute -top-2 -right-2 z-20 flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums transition-opacity duration-150 group-data-[dnd-dropping]/page-drag:opacity-0 motion-reduce:transition-none"
        >
          {preview.count}
        </span>
      )}
      <span className="sr-only">
        {t("sidebar.page", { page: preview.page.pageIndex + 1 })}
      </span>
    </div>
  );
});
