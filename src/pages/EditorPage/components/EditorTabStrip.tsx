import { useMemo, useRef, useState, type DragEvent } from "react";
import { ArrowLeft, ExternalLink, LoaderCircle, Plus, X } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
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
import type {
  EditorMergeWindowTarget,
  EditorTabDragPayload,
  EditorTabDropTarget,
} from "../types";

const EDITOR_TAB_DRAG_MIME = "application/x-legir-editor-tab";
const EDITOR_TAB_DIRTY_DOT_CLASS_NAME =
  "absolute left-1/2 top-1/2 block h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/60";

type TabDropIndicator = {
  tabId: string;
  targetIndex: number;
  position: "before" | "after";
};

interface EditorTabStripProps {
  windowId: EditorMergeWindowTarget["windowId"];
  tabs: EditorTabDescriptor[];
  activeTabId: string | null;
  mergeWindowTargets: EditorMergeWindowTarget[];
  onOpenDocument: () => Promise<void>;
  onRefreshMergeWindowTargets: () => Promise<void>;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onMoveTab: (tabId: string, target: EditorTabDropTarget) => void;
  onDetachTab: (tabId: string) => Promise<void>;
  onMergeTabToWindow: (
    tabId: string,
    targetWindowId: EditorMergeWindowTarget["windowId"],
  ) => Promise<void>;
  canDetachTabs: boolean;
  canMergeTabs: boolean;
}

export function EditorTabStrip({
  windowId,
  tabs,
  activeTabId,
  mergeWindowTargets,
  onOpenDocument,
  onRefreshMergeWindowTargets,
  onSelectTab,
  onCloseTab,
  onMoveTab,
  onDetachTab,
  onMergeTabToWindow,
  canDetachTabs,
  canMergeTabs,
}: EditorTabStripProps) {
  const { t } = useLanguage();
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<TabDropIndicator | null>(
    null,
  );
  const draggedTabPayloadRef = useRef<EditorTabDragPayload | null>(null);
  const dragImageElementRef = useRef<HTMLDivElement | null>(null);
  const draggableTabs = useMemo(
    () => tabs.filter((tab) => !tab.isPendingTransfer),
    [tabs],
  );

  const clearDragImage = () => {
    dragImageElementRef.current?.remove();
    dragImageElementRef.current = null;
  };

  const clearDragState = () => {
    draggedTabPayloadRef.current = null;
    clearDragImage();
    setDraggedTabId(null);
    setDropIndicator(null);
  };

  const parseDragPayload = (event: DragEvent<HTMLElement>) => {
    if (draggedTabPayloadRef.current) {
      return draggedTabPayloadRef.current;
    }

    const raw = event.dataTransfer.getData(EDITOR_TAB_DRAG_MIME);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as Partial<EditorTabDragPayload>;
      if (
        typeof parsed.tabId !== "string" ||
        typeof parsed.sourceWindowId !== "string"
      ) {
        return null;
      }

      return {
        tabId: parsed.tabId,
        sourceWindowId: parsed.sourceWindowId,
      } satisfies EditorTabDragPayload;
    } catch {
      return null;
    }
  };

  const resolveTargetIndex = (
    dragTabId: string,
    overTabId: string,
    position: "before" | "after",
  ) => {
    const overIndex = draggableTabs.findIndex((tab) => tab.id === overTabId);
    const dragIndex = draggableTabs.findIndex((tab) => tab.id === dragTabId);
    if (overIndex < 0 || dragIndex < 0) return null;

    const rawTargetIndex = position === "after" ? overIndex + 1 : overIndex;
    if (dragTabId === overTabId) {
      if (rawTargetIndex === dragIndex || rawTargetIndex === dragIndex + 1) {
        return null;
      }
    }

    return dragIndex < rawTargetIndex ? rawTargetIndex - 1 : rawTargetIndex;
  };

  const updateDropIndicator = (
    dragTabId: string,
    overTabId: string,
    position: "before" | "after",
  ) => {
    const targetIndex = resolveTargetIndex(dragTabId, overTabId, position);
    if (targetIndex === null) {
      setDropIndicator(null);
      return;
    }

    setDropIndicator({
      tabId: overTabId,
      targetIndex,
      position,
    });
  };

  const attachNativeDragImage = (
    event: DragEvent<HTMLDivElement>,
    tab: EditorTabDescriptor,
  ) => {
    if (typeof document === "undefined") return;

    clearDragImage();

    const sourceRect = event.currentTarget.getBoundingClientRect();
    const ghost = document.createElement("div");
    ghost.className =
      "pointer-events-none fixed left-0 top-0 z-[200] flex min-w-0 max-w-64 items-center gap-1.5 rounded-lg border border-border/80 bg-background/95 px-2.5 py-1.5 text-sm text-foreground shadow-xl backdrop-blur";
    ghost.style.width = `${Math.ceil(sourceRect.width)}px`;
    ghost.style.transform = "translate(-10000px, -10000px)";

    const statusSlot = document.createElement("span");
    statusSlot.className = "relative block h-4 w-4 shrink-0";

    if (tab.isDirty) {
      const dirtyDot = document.createElement("span");
      dirtyDot.className = EDITOR_TAB_DIRTY_DOT_CLASS_NAME;
      statusSlot.append(dirtyDot);
    }

    const title = document.createElement("span");
    title.className = "truncate";
    title.textContent = tab.title;

    ghost.append(title, statusSlot);
    document.body.appendChild(ghost);
    dragImageElementRef.current = ghost;

    event.dataTransfer.setDragImage(ghost, 28, sourceRect.height / 2);
  };

  const allowMoveDrop = (event: DragEvent<HTMLElement>) => {
    const payload = parseDragPayload(event);
    if (!payload || payload.sourceWindowId !== windowId) return false;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    return true;
  };

  return (
    <div className="border-border bg-background/95 flex items-center gap-2 border-b px-2 backdrop-blur sm:px-4">
      <div
        className="flex min-w-0 flex-1 items-center overflow-x-auto pt-1 pb-0"
        onDragEnter={(event) => {
          allowMoveDrop(event);
        }}
        onDragOver={(event) => {
          allowMoveDrop(event);
        }}
        onDragLeave={(event) => {
          if (
            event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            return;
          }
          setDropIndicator(null);
        }}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const showDetachAction = canDetachTabs;
          const showMergeAction = canMergeTabs && mergeWindowTargets.length > 0;
          const isPendingTransfer = !!tab.isPendingTransfer;
          const showDropBefore =
            dropIndicator?.tabId === tab.id &&
            dropIndicator.position === "before";
          const showDropAfter =
            dropIndicator?.tabId === tab.id &&
            dropIndicator.position === "after";

          const tabNode = (
            <div
              role={isPendingTransfer ? undefined : "button"}
              tabIndex={isPendingTransfer ? -1 : 0}
              aria-disabled={isPendingTransfer || undefined}
              data-editor-tab-id={tab.id}
              draggable={!isPendingTransfer}
              onDragStart={(event) => {
                if (isPendingTransfer) return;

                const payload: EditorTabDragPayload = {
                  tabId: tab.id,
                  sourceWindowId: windowId,
                };

                draggedTabPayloadRef.current = payload;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                  EDITOR_TAB_DRAG_MIME,
                  JSON.stringify(payload),
                );
                event.dataTransfer.setData("text/plain", tab.id);
                attachNativeDragImage(event, tab);
                setDraggedTabId(tab.id);
                setDropIndicator(null);
              }}
              onDragEnd={() => {
                clearDragState();
              }}
              onDragEnter={(event) => {
                if (isPendingTransfer) return;
                allowMoveDrop(event);
              }}
              onDragOver={(event) => {
                if (isPendingTransfer) return;
                const allowed = allowMoveDrop(event);
                if (!allowed) return;
                const payload = parseDragPayload(event);
                if (!payload) return;

                const rect = event.currentTarget.getBoundingClientRect();
                const position =
                  event.clientX - rect.left < rect.width / 2
                    ? "before"
                    : "after";
                updateDropIndicator(payload.tabId, tab.id, position);
              }}
              onDrop={(event) => {
                if (isPendingTransfer) return;
                const payload = parseDragPayload(event);
                if (!payload || payload.sourceWindowId !== windowId) return;

                event.preventDefault();

                const rect = event.currentTarget.getBoundingClientRect();
                const position =
                  event.clientX - rect.left < rect.width / 2
                    ? "before"
                    : "after";
                const targetIndex = resolveTargetIndex(
                  payload.tabId,
                  tab.id,
                  position,
                );

                clearDragState();
                if (targetIndex === null) return;

                onMoveTab(payload.tabId, {
                  intent: "reorder",
                  windowId,
                  targetIndex,
                });
              }}
              onClick={() => {
                if (isPendingTransfer) return;
                onSelectTab(tab.id);
              }}
              onKeyDown={(event) => {
                if (isPendingTransfer) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onSelectTab(tab.id);
              }}
              className={cn(
                "group border-border/80 bg-background hover:bg-muted flex min-w-0 shrink-0 items-center gap-1.5 rounded-t-lg border-x border-t px-2.5 py-1 text-sm text-nowrap transition-colors select-none hover:cursor-pointer",
                active &&
                  "bg-muted/60 text-foreground border-border border-b-foreground border-b shadow-sm",
                isPendingTransfer &&
                  "text-muted-foreground hover:bg-background hover:cursor-default",
                draggedTabId === tab.id && "opacity-60",
              )}
            >
              <span className="max-w-40 min-w-0 flex-1 truncate text-left sm:max-w-52">
                {tab.title}
              </span>
              {isPendingTransfer ? (
                <LoaderCircle size={14} className="shrink-0 animate-spin" />
              ) : (
                <span className="relative block h-4 w-4 shrink-0">
                  {tab.isDirty && (
                    <span className="pointer-events-none absolute inset-0 transition-opacity duration-150 group-hover:opacity-0">
                      <span className={EDITOR_TAB_DIRTY_DOT_CLASS_NAME} />
                    </span>
                  )}
                  <button
                    type="button"
                    draggable={false}
                    className={cn(
                      "text-muted-foreground hover:text-foreground absolute inset-0 flex items-center justify-center rounded-full transition-opacity duration-150",
                      tab.isDirty
                        ? "opacity-0 group-hover:opacity-100"
                        : "opacity-100",
                    )}
                    aria-label={t("common.actions.close")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
            </div>
          );

          if (isPendingTransfer) {
            return <div key={tab.id}>{tabNode}</div>;
          }

          const wrappedTabNode = (
            <div className="relative shrink-0">
              {showDropBefore && (
                <div className="bg-primary pointer-events-none absolute inset-y-1 left-0 z-20 w-0.5 -translate-x-1/2 rounded-full" />
              )}
              {showDropAfter && (
                <div className="bg-primary pointer-events-none absolute inset-y-1 right-0 z-20 w-0.5 translate-x-1/2 rounded-full" />
              )}
              {tabNode}
            </div>
          );

          return (
            <ContextMenu
              key={tab.id}
              modal={false}
              onOpenChange={(open) => {
                if (!open) return;
                void onRefreshMergeWindowTargets();
              }}
            >
              <ContextMenuTrigger asChild>{wrappedTabNode}</ContextMenuTrigger>
              <ContextMenuContent
                className="min-w-44"
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
              >
                {showDetachAction && (
                  <ContextMenuItem
                    onSelect={() => {
                      void onDetachTab(tab.id);
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
                            void onMergeTabToWindow(tab.id, target.windowId);
                          }}
                        >
                          {target.label}
                        </ContextMenuItem>
                      ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                )}
                {(showDetachAction || showMergeAction) && (
                  <ContextMenuSeparator />
                )}
                <ContextMenuItem
                  variant="destructive"
                  onSelect={() => {
                    onCloseTab(tab.id);
                  }}
                >
                  <X size={14} />
                  {t("common.actions.close")}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 gap-2"
          onClick={() => {
            void onOpenDocument();
          }}
        >
          <Plus size={16} />
        </Button>
      </div>
    </div>
  );
}
