import {
  useCallback,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  DragDropProvider,
  DragOverlay,
  useDragDropManager,
} from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import {
  Feedback,
  PointerActivationConstraints,
  PointerSensor,
  type DragDropManager,
  type DropAnimation,
} from "@dnd-kit/dom";
import { SortableKeyboardPlugin } from "@dnd-kit/dom/sortable";
import {
  Copy,
  FileInput,
  FilePlus2,
  RotateCcw,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ResponsiveToolbar } from "@/components/toolbar/ResponsiveToolbar";
import { getPageGridLayout } from "@/components/page-editor/pageGridLayout";
import { cn } from "@/utils/cn";
import { DemoPageThumbnail } from "./DemoPageThumbnail";
import { demoPageSize } from "./geometry";
import { useDemoViewport } from "./useDemoViewport";
import type { DemoAction, DemoPage, DemoState } from "./types";
import type { DemoCopy } from "./copy";
import { useDemoPageDrag } from "./useDemoPageDrag";

type Props = { state: DemoState; dispatch: Dispatch<DemoAction> };
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

function pageActions(ids: string[], dispatch: Dispatch<DemoAction>) {
  return [
    {
      id: "clockwise",
      Icon: RotateCw,
      label: "toolbar.rotate_clockwise",
      action: () => dispatch({ type: "rotate-pages", ids, delta: 90 }),
    },
    {
      id: "counterclockwise",
      Icon: RotateCcw,
      label: "toolbar.rotate_counterclockwise",
      action: () => dispatch({ type: "rotate-pages", ids, delta: -90 }),
    },
    {
      id: "duplicate",
      Icon: Copy,
      label: "page_editor.duplicate",
      action: () => dispatch({ type: "duplicate-pages", ids }),
    },
    {
      id: "delete",
      Icon: Trash2,
      label: "common.actions.delete",
      action: () => dispatch({ type: "delete-pages", ids }),
    },
  ];
}

export function DemoPageTools({
  state,
  dispatch,
  onOpenApp,
}: Props & { onOpenApp: () => void }) {
  const { t } = useLanguage();
  const container = useRef<HTMLDivElement>(null);
  const { width } = useDemoViewport(container);
  const count = state.selectedPageIds.length;
  const selectionLabel = t(
    count ? "page_editor.selected" : "page_editor.total",
    { count: count || state.pages.length, total: state.pages.length },
  );
  const items = [
    ...[
      {
        id: "import",
        Icon: FileInput,
        label: "page_editor.import",
        action: onOpenApp,
      },
      {
        id: "blank",
        Icon: FilePlus2,
        label: "page_editor.blank",
        action: () => dispatch({ type: "blank-page" }),
      },
    ].map(({ id, Icon, label, action }) => ({
      id,
      label: t(label),
      content: (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 sm:h-9 sm:w-9"
          title={t(label)}
          aria-label={t(label)}
          data-demo-page-action={id}
          onClick={action}
        >
          <Icon size={18} />
        </Button>
      ),
    })),
    ...pageActions(state.selectedPageIds, dispatch).map(
      ({ id, Icon, label, action }) => ({
        id,
        label: t(label),
        content: (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 sm:h-9 sm:w-9"
            title={t(label)}
            aria-label={t(label)}
            data-demo-page-action={id}
            disabled={
              !count || (id === "delete" && count === state.pages.length)
            }
            onClick={action}
          >
            <Icon size={16} />
          </Button>
        ),
      }),
    ),
  ];
  return (
    <div
      className="flex w-full min-w-0 items-center gap-1 sm:gap-2"
      data-page-editor-toolbar
    >
      <div className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs tabular-nums sm:gap-2">
        <Checkbox
          checked={
            count === state.pages.length
              ? true
              : count
                ? "indeterminate"
                : false
          }
          aria-label={t(
            count === state.pages.length
              ? "page_editor.clear_selection"
              : "page_editor.select_all",
          )}
          onCheckedChange={(checked) =>
            dispatch({
              type: "select-pages",
              intent: checked ? "all" : "clear",
            })
          }
        />
        <span
          aria-live="polite"
          aria-label={selectionLabel}
          title={selectionLabel}
        >
          {count ? `${count} / ${state.pages.length}` : state.pages.length}
        </span>
      </div>
      <div
        ref={container}
        className="flex min-w-10 flex-1 items-center justify-center"
      >
        <ResponsiveToolbar
          items={items}
          availableWidth={width}
          variant="inline"
          closeOnAction
        />
      </div>
    </div>
  );
}

function PageCard({
  page,
  index,
  state,
  dispatch,
  copy,
  height,
  onOpen,
  moving,
}: Props & {
  page: DemoPage;
  index: number;
  copy: DemoCopy;
  height: number;
  onOpen: (index: number) => void;
  moving: boolean;
}) {
  const { t } = useLanguage();
  const { ref, handleRef, sourceRef } = useSortable({
    id: page.id,
    index,
    plugins: sortablePlugins,
    // The demo's FLIP animation accounts for its CSS zoom.
    transition: { duration: 0 },
  });
  const dragHandle = useCallback(
    (element: HTMLButtonElement | null) => {
      handleRef(element);
      sourceRef(element);
    },
    [handleRef, sourceRef],
  );
  const selected = state.selectedPageIds.includes(page.id);
  const size = demoPageSize(page);
  const select = () =>
    dispatch({ type: "select-pages", id: page.id, intent: "single" });
  return (
    <div
      ref={ref}
      data-page-card={page.id}
      data-source-page={page.sourcePage}
      data-rotation={page.rotation}
      className="relative min-w-0"
    >
      <div
        data-demo-page-card-content
        className="relative flex min-w-0 flex-col items-center gap-1 p-2 pb-3"
      >
        <div
          className="flex w-full items-center justify-center p-3"
          style={{ height }}
        >
          <button
            ref={dragHandle}
            type="button"
            className={cn(
              "demo-page-handle ring-offset-background focus-visible:ring-primary relative max-h-full max-w-full touch-pan-y p-0 ring-offset-3 outline-none select-none focus-visible:ring-2",
              selected
                ? "ring-primary ring-2"
                : "hover:ring-primary/30 hover:ring-2",
              moving &&
                "opacity-25 group-data-[page-drop-complete]/page-grid:opacity-100",
            )}
            style={{
              aspectRatio: size.width / size.height,
              width: size.width / size.height > 0.78 ? "100%" : undefined,
              height: size.width / size.height <= 0.78 ? "100%" : undefined,
            }}
            aria-label={t("sidebar.page", { page: index + 1 })}
            aria-pressed={selected}
            onClick={select}
            onDoubleClick={() => onOpen(index)}
          >
            <DemoPageThumbnail page={page} state={state} copy={copy} />
          </button>
        </div>
        <div className="flex h-7 w-full items-center justify-center text-sm group-data-[grid-dense]/page-grid:h-12 group-data-[grid-dense]/page-grid:flex-col">
          <span className="mr-auto tabular-nums group-data-[grid-dense]/page-grid:mr-0">
            {index + 1}
          </span>
          <div className="flex items-center">
            {pageActions([page.id], dispatch).map(
              ({ id, Icon, label, action }) => (
                <Button
                  key={id}
                  variant="ghost"
                  size="icon-sm"
                  title={t(label)}
                  aria-label={t(label)}
                  data-demo-page-action={id}
                  disabled={id === "delete" && state.pages.length === 1}
                  onClick={() => {
                    select();
                    action();
                  }}
                >
                  <Icon size={16} />
                </Button>
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DemoPageEditor({
  state,
  dispatch,
  copy,
  onOpen,
  dragManager,
}: Props & {
  copy: DemoCopy;
  onOpen: (index: number) => void;
  dragManager: RefObject<DragDropManager | null>;
}) {
  const { t } = useLanguage();
  const grid = useRef<HTMLDivElement>(null);
  const { width } = useDemoViewport(grid);
  const layout = getPageGridLayout(width, state.thumbnailScale);
  const drag = useDemoPageDrag(grid, state, dispatch, dragManager);
  return (
    <section
      className="bg-muted/40 flex min-h-0 flex-1 flex-col"
      data-page-editor
      aria-label={t("mode.pages")}
      onPointerDownCapture={drag.onPointerDownCapture}
    >
      <DragDropProvider
        sensors={(defaults) => [
          ...defaults.filter((sensor) => sensor !== PointerSensor),
          pointerSensor,
        ]}
        onDragStart={drag.onDragStart}
        onDragOver={drag.onDragOver}
        onDragEnd={drag.onDragEnd}
      >
        <div
          ref={grid}
          className="group/page-grid min-h-0 flex-1 overflow-auto"
          data-page-grid
          data-grid-dense={layout.dense || undefined}
          onClick={(event) => {
            if (!(event.target as HTMLElement).closest("button"))
              dispatch({ type: "select-pages", intent: "clear" });
          }}
        >
          <div
            className="mx-4 grid gap-x-4"
            style={{
              gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
            }}
          >
            {drag.displayed.map((page, index) => (
              <PageCard
                key={page.id}
                {...{ page, index, state, dispatch, copy, onOpen }}
                height={layout.thumbnailHeight}
                moving={drag.moving.includes(page.id)}
              />
            ))}
          </div>
        </div>
        <PageDragOverlay
          {...{ state, copy, dragManager }}
          dropAnimation={drag.dropAnimation}
        />
      </DragDropProvider>
    </section>
  );
}

function PageDragOverlay({
  state,
  copy,
  dragManager,
  dropAnimation,
}: {
  state: DemoState;
  copy: DemoCopy;
  dragManager: RefObject<DragDropManager | null>;
  dropAnimation: DropAnimation;
}) {
  const manager = useDragDropManager();
  useLayoutEffect(() => {
    dragManager.current = manager;
    return () => {
      dragManager.current = null;
    };
  }, [dragManager, manager]);
  return createPortal(
    <DragOverlay
      className="demo-page-drag-overlay m-0 hidden overflow-visible border-0 bg-transparent p-0 shadow-none outline-none data-[dnd-dragging]:block"
      dropAnimation={dropAnimation}
    >
      {(source) => {
        const page = state.pages.find((page) => page.id === source.id);
        return page ? (
          <div
            data-demo-page-drag-preview={page.id}
            className="relative h-full w-full origin-top-left"
          >
            <DemoPageThumbnail page={page} state={state} copy={copy} />
          </div>
        ) : null;
      }}
    </DragOverlay>,
    // Feedback uses viewport pixels; escape the editor's CSS zoom. Fullscreen
    // already renders the editor at its normal scale.
    document.fullscreenElement ?? document.body,
  );
}
