import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import {
  Feedback,
  PointerSensor,
  PointerActivationConstraints,
} from "@dnd-kit/dom";
import { SortableKeyboardPlugin } from "@dnd-kit/dom/sortable";
import { useEditorView, useEditorViewApi } from "@/store/useEditorView";
import { useLanguage } from "@/components/language-provider";
import { getPageId } from "@/services/pdfService/lib/pageStructure";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import type { PlatformDroppedPdf } from "@/services/platform";
import type { PageData } from "@/types";
import { cn } from "@/utils/cn";
import { useThumbnailViewport } from "@/hooks/useThumbnailViewport";
import { getPageView } from "@/components/workspace/lib/pageViewRotation";
import { PageThumbnail } from "./PageThumbnail";
import { PageActions } from "./PageActions";
import { PageDragPreview } from "./PageDragPreview";
import { PageSelectionMenu } from "./PageSelectionMenu";
import { previewPageMove } from "./pageDrag";
import { usePageGridViewport } from "./usePageGridViewport";
import { usePageFileDrop } from "./usePageFileDrop";
import { usePageDropAnimation } from "./usePageDropAnimation";
import type { PageDragPreviewData, PageSelectionIntent } from "./types";

// React owns the preview order so a selected block commits as one undo step.
const sortablePlugins = [
  SortableKeyboardPlugin,
  Feedback.configure({ feedback: "clone" }),
];
const pointerSensor = PointerSensor.configure({
  activationConstraints(event) {
    return event.pointerType === "touch"
      ? [
          new PointerActivationConstraints.Delay({
            value: 250,
            tolerance: { x: 5, y: 5 },
          }),
        ]
      : [new PointerActivationConstraints.Distance({ value: 6 })];
  },
});

const DocumentPageThumbnail = memo(function DocumentPageThumbnail({
  page,
  ref,
}: {
  page: PageData;
  ref?: Ref<HTMLDivElement>;
}) {
  const image = useEditorView((state) => state.thumbnailImages[page.pageIndex]);
  return <PageThumbnail ref={ref} page={page} worker={null} image={image} />;
});

type GridProps = {
  pages: PageData[];
  selectedPageIds: string[];
  workerService: PDFWorkerService | null;
  enabled: boolean;
  onOpen: (pageIndex: number) => void;
  onFilesDrop: (files: Promise<PlatformDroppedPdf[]>, index: number) => void;
  run: (action: () => void) => void;
};

const PageCard = memo(function PageCard({
  page,
  index,
  total,
  selected,
  moving,
  canSelectRange,
  enabled,
  onSelect,
  onOpen,
  run,
}: {
  page: PageData;
  index: number;
  total: number;
  selected: boolean;
  moving: boolean;
  canSelectRange: () => boolean;
  enabled: boolean;
  onSelect: (page: PageData, intent: PageSelectionIntent) => void;
  onOpen: GridProps["onOpen"];
  run: GridProps["run"];
}) {
  const { t } = useLanguage();
  const id = getPageId(page);
  const view = getPageView(page, 0);
  const aspectRatio = view.width / view.height;
  const ids = useMemo(() => [id], [id]);
  const select = useCallback(
    (intent: PageSelectionIntent) => onSelect(page, intent),
    [onSelect, page],
  );
  // Sort whole cards, but measure the paper itself for the drag and drop overlay.
  const { ref, sourceRef, handleRef } = useSortable({
    id,
    index,
    disabled: !enabled,
    plugins: sortablePlugins,
    // Moving placeholders must reach their slots before drop geometry is read.
    transition: { duration: moving ? 0 : 200, easing: "ease-out" },
  });
  return (
    <div
      ref={ref}
      data-page-card={id}
      data-page-index={index}
      className={cn(
        "relative flex h-full min-w-0 flex-col items-center gap-1 p-2 pb-3",
        moving &&
          "opacity-25 group-data-[page-drop-complete]/page-grid:opacity-100",
      )}
    >
      <div
        data-page-paper-area
        className="flex min-h-0 w-full flex-1 items-center justify-center p-3"
      >
        <PageSelectionMenu
          selected={selected}
          canSelectRange={canSelectRange}
          disabled={moving}
          onSelect={select}
        >
          <button
            ref={handleRef}
            data-thumbnail-page-id={id}
            type="button"
            className={cn(
              "ring-offset-background focus-visible:ring-primary relative flex max-h-full max-w-full touch-pan-y items-center justify-center p-0 ring-offset-3 outline-none select-none group-data-[page-dragging]/page-grid:ring-0 group-data-[page-dragging]/page-grid:ring-offset-0 focus-visible:ring-2 group-data-[page-dragging]/page-grid:focus-visible:ring-0",
              selected
                ? "ring-primary ring-2"
                : "hover:ring-primary/30 hover:ring-2 group-data-[page-dragging]/page-grid:hover:ring-0",
            )}
            style={{
              width: aspectRatio > 0.78 ? "100%" : undefined,
              height: aspectRatio <= 0.78 ? "100%" : undefined,
              aspectRatio,
            }}
            data-page-drag-handle
            aria-pressed={selected}
            aria-label={t("sidebar.page", { page: index + 1 })}
            onClick={(event) => {
              const toggle = event.ctrlKey || event.metaKey;
              select(
                event.shiftKey
                  ? toggle
                    ? "addRange"
                    : "range"
                  : toggle
                    ? "toggle"
                    : "single",
              );
            }}
            onDoubleClick={() => onOpen(page.pageIndex)}
          >
            <DocumentPageThumbnail ref={sourceRef} page={page} />
          </button>
        </PageSelectionMenu>
      </div>
      <div className="flex h-7 w-full shrink-0 items-center justify-center text-sm group-data-[grid-dense]/page-grid:h-12 group-data-[grid-dense]/page-grid:flex-col group-data-[grid-dense]/page-grid:gap-1">
        <span className="mr-auto tabular-nums group-data-[grid-dense]/page-grid:mr-0 group-data-[grid-dense]/page-grid:leading-4">
          {index + 1}
        </span>
        <div className="flex items-center">
          <PageActions
            ids={ids}
            total={total}
            enabled={enabled}
            compact
            run={run}
          />
        </div>
      </div>
    </div>
  );
});

type DragState = {
  source: PageData;
  pages: PageData[];
  ids: Set<string>;
  beforeIndex: number | null;
  preview: PageData[];
};

export const PageGrid = memo(function PageGrid({
  pages,
  selectedPageIds,
  workerService,
  enabled,
  onOpen,
  onFilesDrop,
  run,
}: GridProps) {
  const store = useEditorViewApi();
  const selection = useMemo(() => new Set(selectedPageIds), [selectedPageIds]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [overlay, setOverlay] = useState<PageDragPreviewData | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const { scrollRef, viewport, layout, layoutRef, updateScroll } =
    usePageGridViewport(dragRef);
  useThumbnailViewport(scrollRef);
  useEffect(() => {
    if (workerService) store.getState().warmupThumbnails(workerService);
  }, [store, workerService]);
  const { dropping, prepareDrop, dropAnimation } =
    usePageDropAnimation(scrollRef);
  const anchor = useRef<string | null>(null);
  const canSelectRange = useCallback(
    () => !!(anchor.current ?? store.getState().selectedPageIds[0]),
    [store],
  );
  const { columns, rowHeight } = layout;
  const { fileDropIndex, fileDropProps } = usePageFileDrop({
    scrollRef,
    columns,
    rowHeight,
    total: pages.length,
    enabled,
    onDrop: onFilesDrop,
  });
  const releaseDragImages = useRef<(() => void) | undefined>(undefined);
  const dragging = !!drag || !!dropping;
  useEffect(() => {
    if (!dragging) {
      releaseDragImages.current?.();
      releaseDragImages.current = undefined;
    }
  }, [dragging]);
  useEffect(() => () => releaseDragImages.current?.(), []);
  // A store commit can render before React clears the drag preview. Its old
  // page indices must never read the newly reindexed thumbnail cache.
  const displayed = drag?.pages === pages ? drag.preview : pages;
  const rowCount = Math.ceil(displayed.length / columns);
  const startRow = Math.max(0, Math.floor(viewport.top / rowHeight) - 2);
  const endRow = Math.min(
    rowCount,
    Math.ceil((viewport.top + viewport.height) / rowHeight) + 2,
  );
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { columns, rowHeight } = layoutRef.current;
    const selected = new Set(store.getState().selectedPageIds);
    const index = pages.findIndex((page) => selected.has(getPageId(page)));
    if (index >= 0 && !el.hasAttribute("data-page-dropping")) {
      const top = Math.floor(index / columns) * rowHeight;
      if (top < el.scrollTop || top >= el.scrollTop + el.clientHeight)
        el.scrollTop = top;
    }
    el.scrollTop = Math.min(
      el.scrollTop,
      Math.max(
        0,
        Math.ceil(pages.length / columns) * rowHeight - el.clientHeight,
      ),
    );
    const top = el.scrollTop;
    updateScroll(top);
  }, [pages, store, scrollRef, layoutRef, updateScroll]);
  const selectPage = useCallback(
    (page: PageData, intent: PageSelectionIntent) => {
      if (dragRef.current) return;
      const id = getPageId(page);
      const current = store.getState();
      const pages = current.pages;
      let ids = new Set(current.selectedPageIds);
      const anchored = pages.findIndex((p) => getPageId(p) === anchor.current);
      const from =
        anchored >= 0
          ? anchored
          : pages.findIndex((p) => getPageId(p) === current.selectedPageIds[0]);
      if (intent === "all") ids = new Set(pages.map(getPageId));
      else if (intent === "clear") {
        ids.clear();
        anchor.current = null;
      } else if ((intent === "range" || intent === "addRange") && from >= 0) {
        if (intent === "range") ids = new Set();
        for (
          let n = Math.min(from, page.pageIndex);
          n <= Math.max(from, page.pageIndex);
          n++
        )
          ids.add(getPageId(pages[n]));
      } else if (intent === "toggle") {
        if (ids.has(id)) ids.delete(id);
        else ids.add(id);
        anchor.current = id;
      } else {
        ids = new Set([id]);
        anchor.current = id;
      }
      store.getState().setSelectedPageIds([...ids]);
    },
    [store],
  );
  // An append marker belongs beside the last card, including a full final row.
  const markerIndex =
    fileDropIndex === pages.length
      ? Math.max(0, fileDropIndex - 1)
      : fileDropIndex;
  return (
    <DragDropProvider
      sensors={(defaults) => [
        ...defaults.filter((sensor) => sensor !== PointerSensor),
        pointerSensor,
      ]}
      onDragStart={(event) => {
        const source = pages.find(
          (page) => getPageId(page) === event.operation.source?.id,
        );
        if (!source) return;
        releaseDragImages.current?.();
        releaseDragImages.current = store.getState().holdThumbnailImages();
        const id = getPageId(source);
        const { thumbnailImages } = store.getState();
        const ids = new Set(selection.has(id) ? selectedPageIds : [id]);
        anchor.current = id;
        if (!selection.has(id)) store.getState().setSelectedPageIds([id]);
        dragRef.current = {
          source,
          ids,
          pages,
          preview: pages,
          beforeIndex: null,
        };
        const stack: PageDragPreviewData["stack"] = [];
        let bounds: PageDragPreviewData["bounds"];
        if (ids.size > 1) {
          // Read the common paper area once, not every selected thumbnail.
          // Backing pages must not inherit the dragged paper's aspect ratio.
          const area = event.operation.source?.handle?.closest(
            "[data-page-paper-area]",
          );
          if (area) {
            const rect = area.getBoundingClientRect();
            const style = getComputedStyle(area);
            bounds = {
              width:
                rect.width -
                parseFloat(style.paddingLeft) -
                parseFloat(style.paddingRight),
              height:
                rect.height -
                parseFloat(style.paddingTop) -
                parseFloat(style.paddingBottom),
            };
          }
          for (const page of pages) {
            const pageId = getPageId(page);
            if (pageId !== id && ids.has(pageId)) {
              stack.push({ page, image: thumbnailImages[page.pageIndex] });
              if (stack.length === 2) break;
            }
          }
        }
        setOverlay({
          page: source,
          count: ids.size,
          bounds,
          image: thumbnailImages[source.pageIndex],
          stack,
        });
        setDrag(dragRef.current);
      }}
      onDragOver={(event) => {
        const current = dragRef.current;
        const targetId = event.operation.target?.id;
        if (!current || !targetId || current.ids.has(String(targetId))) return;
        const sourceIndex = current.preview.findIndex(
          (page) => getPageId(page) === getPageId(current.source),
        );
        const targetIndex = current.preview.findIndex(
          (page) => getPageId(page) === targetId,
        );
        const originalIndex = current.pages.findIndex(
          (page) => getPageId(page) === targetId,
        );
        if (targetIndex < 0 || originalIndex < 0) return;
        const beforeIndex = originalIndex + (targetIndex > sourceIndex ? 1 : 0);
        const preview = previewPageMove(
          current.pages,
          current.ids,
          beforeIndex,
        );
        if (preview.every((page, index) => page === current.preview[index]))
          return;
        dragRef.current = { ...current, beforeIndex, preview };
        setDrag(dragRef.current);
      }}
      onDragEnd={(event) => {
        const current = dragRef.current;
        prepareDrop(current?.ids);
        dragRef.current = null;
        setDrag(null);
        if (
          !event.canceled &&
          event.operation.target &&
          current &&
          current.beforeIndex !== null &&
          store.getState().pages === current.pages
        )
          run(() =>
            store.getState().movePages([...current.ids], current.beforeIndex!),
          );
      }}
    >
      <div
        ref={scrollRef}
        className="group/page-grid min-h-0 flex-1 overflow-auto"
        data-page-grid
        data-grid-dense={layout.dense || undefined}
        data-grid-columns={columns}
        data-grid-row-height={rowHeight}
        data-page-dragging={drag || dropping ? "true" : undefined}
        data-page-dropping={dropping ? "true" : undefined}
        {...fileDropProps}
        onContextMenuCapture={(event) => {
          if (dragRef.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onClick={(event) => {
          if (
            !dragRef.current &&
            event.target instanceof Element &&
            event.currentTarget.contains(event.target) &&
            !event.target.closest("button, [role='menuitem']")
          ) {
            anchor.current = null;
            store.getState().setSelectedPageIds([]);
          }
        }}
        onScroll={(event) => {
          const top = event.currentTarget.scrollTop;
          updateScroll(top);
        }}
      >
        <div className="relative mx-4" style={{ height: rowCount * rowHeight }}>
          <div
            className="absolute inset-x-0 grid gap-x-4"
            style={{
              top: startRow * rowHeight,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gridAutoRows: rowHeight,
            }}
          >
            {displayed
              .slice(startRow * columns, endRow * columns)
              .map((page, offset) => {
                const id = getPageId(page);
                return (
                  <PageCard
                    key={id}
                    page={page}
                    index={startRow * columns + offset}
                    total={pages.length}
                    selected={selection.has(id)}
                    moving={(drag?.ids ?? dropping)?.has(id) ?? false}
                    canSelectRange={canSelectRange}
                    enabled={enabled}
                    onSelect={selectPage}
                    onOpen={onOpen}
                    run={run}
                  />
                );
              })}
          </div>
          {fileDropIndex !== null && markerIndex !== null && (
            <div
              className="bg-primary pointer-events-none absolute z-10 w-1 rounded-full"
              data-file-insertion-index={fileDropIndex}
              style={{
                top: Math.floor(markerIndex / columns) * rowHeight + 8,
                height: rowHeight - 16,
                left:
                  fileDropIndex === pages.length
                    ? `calc(${(((markerIndex % columns) + 1) * 100) / columns}% + ${(((markerIndex % columns) + 1) * 16) / columns - 12}px)`
                    : `calc(${((markerIndex % columns) * 100) / columns}% + ${((markerIndex % columns) * 16) / columns - 4}px)`,
              }}
            />
          )}
        </div>
      </div>
      <DragOverlay
        className="group/page-drag m-0 hidden overflow-visible border-0 bg-transparent p-0 shadow-none outline-none data-[dnd-dragging]:block"
        dropAnimation={dropAnimation}
      >
        {overlay && <PageDragPreview preview={overlay} />}
      </DragOverlay>
    </DragDropProvider>
  );
});
