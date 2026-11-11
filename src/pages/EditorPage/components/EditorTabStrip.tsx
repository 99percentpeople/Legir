import { useEffect, useRef, useState } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import {
  KeyboardSensor,
  PointerSensor,
  PointerActivationConstraints,
} from "@dnd-kit/dom";
import { RestrictToElement } from "@dnd-kit/dom/modifiers";
import { ArrowLeft, ExternalLink, Home, LoaderCircle, X } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/utils/cn";
import type { EditorTabDescriptor } from "@/app/editorTabs/types";
import { useEditorTabsRuntime } from "@/app/editorRuntime";
import "./EditorTabStrip.css";

const tabSensors = [
  PointerSensor.configure({
    activationConstraints(event) {
      return event.pointerType === "touch"
        ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
        : [new PointerActivationConstraints.Distance({ value: 6 })];
    },
    preventActivation: (event) =>
      event.target instanceof Element && !!event.target.closest("button"),
  }),
  KeyboardSensor.configure({
    keyboardCodes: {
      ...KeyboardSensor.defaults.keyboardCodes,
      start: ["Space"],
    },
  }),
];
const tabModifiers = [
  RestrictToElement.configure({
    element: ({ source }) =>
      source?.element?.closest(".editor-tab-scroller") ?? null,
  }),
];
const TAB_CLASS_NAME =
  "editor-tab group text-muted-foreground relative isolate flex h-[34px] min-w-0 shrink-0 items-center gap-2 bg-transparent text-[13px] leading-5 text-nowrap transition-colors select-none hover:cursor-pointer";
const ACTIVE_TAB_CLASS_NAME = "editor-tab--active text-foreground";
const EDITOR_TAB_DIRTY_DOT_CLASS_NAME =
  "absolute left-1/2 top-1/2 block h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/60";

export function EditorTabStrip({
  isHomeActive,
  onHome,
}: {
  isHomeActive: boolean;
  onHome: () => void;
}) {
  const { windowId, tabs, activeTabId, selectTab, moveTab } =
    useEditorTabsRuntime();
  const { t } = useLanguage();
  const [dragging, setDragging] = useState(false);
  const beforeDrag = useRef<string[] | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sortableIds = tabs
    .filter((tab) => !tab.isPendingTransfer)
    .map((tab) => tab.id);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        scroller.scrollWidth <= scroller.clientWidth
      )
        return;

      // Use one axis so diagonal trackpad gestures are not counted twice.
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      if (!delta) return;
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? parseFloat(getComputedStyle(scroller).lineHeight) || 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? scroller.clientWidth
            : 1;
      event.preventDefault();
      scroller.scrollLeft += delta * unit;
    };
    // React's delegated wheel listener is passive; cancel native vertical scrolling here.
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <DragDropProvider
      sensors={tabSensors}
      modifiers={tabModifiers}
      onDragStart={(event) => {
        beforeDrag.current = sortableIds;
        setDragging(true);
        const tabId = event.operation.source?.id;
        if (
          typeof tabId === "string" &&
          sortableIds.includes(tabId) &&
          (isHomeActive || tabId !== activeTabId)
        ) {
          selectTab(tabId);
        }
      }}
      onDragEnd={(event) => {
        setDragging(false);
        const snapshot = beforeDrag.current;
        beforeDrag.current = null;
        const { source } = event.operation;
        // Sorting previews stay in dnd-kit; commit once, only if the live tabs
        // have not been closed, opened or transferred during this gesture.
        if (
          event.canceled ||
          !isSortable(source) ||
          !snapshot ||
          snapshot.length !== sortableIds.length ||
          !snapshot.every((id, index) => id === sortableIds[index]) ||
          source.initialIndex === source.index ||
          source.index < 0 ||
          source.index >= snapshot.length
        )
          return;
        moveTab(String(source.id), {
          intent: "reorder",
          windowId,
          targetIndex: source.index,
        });
      }}
    >
      <div
        className="editor-tab-strip flex h-10 shrink-0 items-end pt-1.5 sm:px-1"
        data-app-keyboard-dragging={dragging ? "true" : undefined}
      >
        <div
          ref={scrollerRef}
          className="editor-tab-scroller no-scrollbar flex min-w-0 flex-1 items-end overflow-x-auto"
        >
          <div className="editor-tab-slot relative shrink-0">
            <button
              type="button"
              draggable={false}
              className={cn(
                TAB_CLASS_NAME,
                isHomeActive && ACTIVE_TAB_CLASS_NAME,
              )}
              aria-current={isHomeActive ? "page" : undefined}
              onClick={onHome}
            >
              <Home size={16} className="shrink-0" />
              <span>{t("tabs.home")}</span>
            </button>
          </div>
          {tabs.map((tab) => (
            <SortableEditorTab
              key={tab.id}
              tab={tab}
              active={tab.id === activeTabId}
              index={sortableIds.indexOf(tab.id)}
              dragging={dragging}
            />
          ))}
        </div>
      </div>
    </DragDropProvider>
  );
}

function SortableEditorTab({
  tab,
  active,
  index,
  dragging,
}: {
  tab: EditorTabDescriptor;
  active: boolean;
  index: number;
  dragging: boolean;
}) {
  const {
    canDetachTabs,
    canMergeTabs,
    mergeWindowTargets,
    refreshMergeWindowTargets,
    selectTab,
    closeTab,
    detachTab,
    mergeTabToWindow,
  } = useEditorTabsRuntime();
  const { t } = useLanguage();
  const isPendingTransfer = !!tab.isPendingTransfer;
  const showDetachAction = canDetachTabs;
  const showMergeAction = canMergeTabs && mergeWindowTargets.length > 0;
  const { ref, handleRef, isDragSource } = useSortable({
    id: tab.id,
    index,
    disabled: isPendingTransfer,
    transition: {
      duration: 200,
      easing: "cubic-bezier(0.25, 1, 0.5, 1)",
      idle: true,
    },
  });
  const tabNode = (
    <div
      role={isPendingTransfer ? undefined : "button"}
      tabIndex={isPendingTransfer ? -1 : 0}
      aria-disabled={isPendingTransfer || undefined}
      aria-current={active ? "page" : undefined}
      data-editor-tab-id={tab.id}
      ref={handleRef}
      draggable={false}
      data-app-keyboard-handle="editor-tab-sort"
      onClick={() => {
        if (isPendingTransfer) return;
        selectTab(tab.id);
      }}
      onKeyDown={(event) => {
        if (
          isPendingTransfer ||
          event.defaultPrevented ||
          event.target !== event.currentTarget
        )
          return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        selectTab(tab.id);
      }}
      className={cn(
        TAB_CLASS_NAME,
        active && ACTIVE_TAB_CLASS_NAME,
        isPendingTransfer && "hover:cursor-default",
      )}
    >
      <span className="max-w-40 min-w-0 flex-1 truncate text-left sm:max-w-52">
        {tab.title}
      </span>
      {isPendingTransfer ? (
        <LoaderCircle size={14} className="shrink-0 animate-spin" />
      ) : (
        <span className="relative block h-5 w-5 shrink-0">
          {tab.isDirty && (
            <span className="pointer-events-none absolute inset-0 transition-opacity duration-150 group-focus-within:opacity-0 group-hover:opacity-0">
              <span className={EDITOR_TAB_DIRTY_DOT_CLASS_NAME} />
            </span>
          )}
          <button
            type="button"
            draggable={false}
            className={cn(
              "text-muted-foreground hover:text-foreground hover:bg-foreground/10 focus-visible:ring-ring absolute inset-0 flex items-center justify-center rounded-full transition-colors duration-150 outline-none focus-visible:ring-2",
              tab.isDirty
                ? "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                : "opacity-100",
            )}
            aria-label={t("common.actions.close")}
            onClick={(event) => {
              event.stopPropagation();
              closeTab(tab.id);
            }}
          >
            <X size={14} />
          </button>
        </span>
      )}
    </div>
  );

  const wrappedTabNode = (
    <div
      ref={ref}
      className="editor-tab-slot relative shrink-0"
      data-tab-dragging={isDragSource || undefined}
    >
      {tabNode}
    </div>
  );
  if (isPendingTransfer) return wrappedTabNode;

  return (
    <ContextMenu
      key={tab.id}
      modal={false}
      onOpenChange={(open) => {
        if (!open) return;
        void refreshMergeWindowTargets();
      }}
    >
      <ContextMenuTrigger asChild disabled={dragging}>
        {wrappedTabNode}
      </ContextMenuTrigger>
      <ContextMenuContent
        className="min-w-44"
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
      >
        {showDetachAction && (
          <ContextMenuItem
            onSelect={() => {
              void detachTab(tab.id);
            }}
          >
            <ExternalLink size={14} />
            {t("tabs.detach_to_new_window")}
          </ContextMenuItem>
        )}
        {showMergeAction && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ArrowLeft size={14} />
              {t("tabs.merge_to_window")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-52">
              {mergeWindowTargets.map((target) => (
                <ContextMenuItem
                  key={target.windowId}
                  onSelect={() => {
                    void mergeTabToWindow(tab.id, target.windowId);
                  }}
                >
                  {target.label}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        {(showDetachAction || showMergeAction) && <ContextMenuSeparator />}
        <ContextMenuItem
          variant="destructive"
          onSelect={() => {
            closeTab(tab.id);
          }}
        >
          <X size={14} />
          {t("common.actions.close")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
