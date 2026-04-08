import React from "react";
import { X, Layers, List, LayoutGrid, StickyNote } from "lucide-react";
import {
  FormField,
  PageData,
  PDFOutlineItem,
  Annotation,
  AnnotationReply,
  ThumbnailsLayoutMode,
} from "@/types";
import { cn } from "@/utils/cn";
import {
  LEFT_SIDEBAR_MAX_WIDTH_PX,
  LEFT_SIDEBAR_MIN_WIDTH_PX,
} from "@/constants";
import { useResizableSidePanel } from "@/hooks/useResizableSidePanel";
import FieldTreePanel from "./FieldTreePanel";
import AnnotationsPanel from "./AnnotationsPanel";
import DocumentOutlinePanel from "./OutlinePanel";
import ThumbnailsPanel from "./ThumbnailsPanel";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { useLanguage } from "../language-provider";
import type { AppEventMap } from "@/lib/eventBus";

interface SidebarProps {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onExitSearch?: () => void;
  isFloating?: boolean;
  pages: PageData[];
  fields: FormField[];
  annotations?: Annotation[];
  outline: PDFOutlineItem[];
  selectedId: string | null;
  onSelectControl: (
    id: string,
    options?: Omit<AppEventMap["workspace:focusControl"], "id">,
  ) => void;
  onDeleteAnnotation?: (id: string) => void;
  onUpdateAnnotation?: (id: string, updates: Partial<Annotation>) => void;
  onAddAnnotationReply?: (annotationId: string, reply: AnnotationReply) => void;
  onUpdateAnnotationReply?: (
    annotationId: string,
    replyId: string,
    updates: Partial<AnnotationReply>,
  ) => void;
  onDeleteAnnotationReply?: (annotationId: string, replyId: string) => void;
  onNavigatePage: (pageIndex: number) => void;
  width: number;
  onResize: (width: number) => void;
  currentPageIndex?: number;
  thumbnailsLayout?: ThumbnailsLayoutMode;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  searchContent?: React.ReactNode;
  searchHeaderContent?: React.ReactNode;
  isSearchActive?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onOpen,
  onClose,
  onExitSearch,
  isFloating = false,
  pages,
  fields,
  annotations = [],
  outline,
  selectedId,
  onSelectControl,
  onDeleteAnnotation = () => {},
  onUpdateAnnotation = () => {},
  onAddAnnotationReply = () => {},
  onUpdateAnnotationReply = () => {},
  onDeleteAnnotationReply = () => {},
  onNavigatePage,
  width,
  onResize,
  currentPageIndex,
  thumbnailsLayout,
  activeTab,
  onTabChange,
  searchContent,
  searchHeaderContent,
  isSearchActive = false,
}) => {
  const { t } = useLanguage();

  const { isResizing, handleMouseDown } = useResizableSidePanel({
    side: "left",
    isOpen,
    width,
    minWidth: LEFT_SIDEBAR_MIN_WIDTH_PX,
    maxWidth: LEFT_SIDEBAR_MAX_WIDTH_PX,
    onResize,
    onCollapse: onClose,
    onExpand: onOpen,
    cursorSource: "sidebar-resize",
  });

  // Local state for uncontrolled mode if activeTab is not provided
  const [localTab, setLocalTab] = React.useState("thumbnails");
  const currentTab = activeTab !== undefined ? activeTab : localTab;
  const handleTabChange = (val: string) => {
    if (onTabChange) onTabChange(val);
    else setLocalTab(val);
  };

  if (!isOpen) {
    return (
      <>
        <div
          className={cn(
            "absolute top-0 bottom-0 left-0 z-40 w-1 cursor-col-resize transition-colors",
            isResizing ? "bg-border" : "hover:bg-primary/50",
          )}
          onMouseDown={handleMouseDown}
        />

        {isResizing && (
          <div className="fixed inset-0 z-9999 cursor-col-resize bg-transparent" />
        )}
      </>
    );
  }

  return (
    <div
      className={cn(
        "bg-background border-border flex h-full shrink-0 flex-col border-r duration-200",
        isResizing ? "transition-none" : "transition-colors",
        isFloating
          ? "absolute top-0 bottom-0 left-0 z-40 shadow-2xl"
          : "relative z-20",
      )}
      style={{ width: width }}
    >
      <Tabs
        value={currentTab}
        onValueChange={handleTabChange}
        className="flex h-full flex-col"
      >
        {/* Header */}
        <div className="bg-muted/30 border-border flex shrink-0 items-center justify-between gap-2 border-b p-2">
          {isSearchActive && searchHeaderContent ? (
            searchHeaderContent
          ) : (
            <TabsList className="flex h-8 flex-1 justify-end">
              <TabsTrigger
                value="thumbnails"
                className="data-[state=active]:bg-muted h-full w-9 p-0 text-xs"
                title={t("sidebar.thumbnails")}
              >
                <LayoutGrid size={16} />
              </TabsTrigger>
              <TabsTrigger
                value="outline"
                className="data-[state=active]:bg-muted h-full w-9 p-0 text-xs"
                title={t("sidebar.outline")}
              >
                <List size={16} />
              </TabsTrigger>
              <TabsTrigger
                value="fields"
                className="data-[state=active]:bg-muted h-full w-9 p-0 text-xs"
                title={t("sidebar.fields")}
              >
                <Layers size={16} />
              </TabsTrigger>
              <TabsTrigger
                value="annotations"
                className="data-[state=active]:bg-muted h-full w-9 p-0 text-xs"
                title={t("sidebar.annotations")}
              >
                <StickyNote size={16} />
              </TabsTrigger>
            </TabsList>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={isSearchActive ? (onExitSearch ?? onClose) : onClose}
            className="h-8 w-8 shrink-0"
            title={
              isSearchActive
                ? t("sidebar.exit_search")
                : t("common.actions.close")
            }
          >
            <X size={16} />
          </Button>
        </div>

        {/* Content */}
        <div className="relative flex flex-1 flex-col overflow-hidden">
          <TabsContent
            value="thumbnails"
            className="mt-0 flex h-full flex-1 flex-col data-[state=inactive]:hidden"
          >
            <ThumbnailsPanel
              pages={pages}
              onNavigate={onNavigatePage}
              currentPageIndex={currentPageIndex}
              thumbnailsLayout={thumbnailsLayout}
            />
          </TabsContent>
          <TabsContent
            value="outline"
            className="mt-0 flex h-full flex-1 flex-col data-[state=inactive]:hidden"
          >
            <DocumentOutlinePanel
              outline={outline}
              onNavigate={onNavigatePage}
              currentPageIndex={currentPageIndex}
            />
          </TabsContent>
          <TabsContent
            value="fields"
            className="mt-0 flex h-full flex-1 flex-col data-[state=inactive]:hidden"
          >
            <FieldTreePanel
              pages={pages}
              fields={fields}
              selectedId={selectedId}
              onSelectControl={onSelectControl}
            />
          </TabsContent>
          <TabsContent
            value="annotations"
            className="mt-0 flex h-full flex-1 flex-col data-[state=inactive]:hidden"
          >
            <AnnotationsPanel
              annotations={annotations}
              onSelectControl={onSelectControl}
              onDeleteAnnotation={onDeleteAnnotation}
              onUpdateAnnotation={onUpdateAnnotation}
              onAddAnnotationReply={onAddAnnotationReply}
              onUpdateAnnotationReply={onUpdateAnnotationReply}
              onDeleteAnnotationReply={onDeleteAnnotationReply}
              selectedId={selectedId}
            />
          </TabsContent>
          {searchContent ? (
            <TabsContent
              value="search"
              className="mt-0 flex h-full flex-1 flex-col data-[state=inactive]:hidden"
            >
              {searchContent}
            </TabsContent>
          ) : null}
        </div>
      </Tabs>

      {/* Resize Handle */}
      <div
        className={cn(
          "absolute top-0 right-0 bottom-0 z-50 w-1 cursor-col-resize",
          isResizing ? "transition-none" : "transition-colors",
          isResizing ? "bg-primary/50" : "hover:bg-primary/50",
        )}
        onMouseDown={handleMouseDown}
      />

      {/* Resize Overlay */}
      {isResizing && (
        <div className="fixed inset-0 z-9999 cursor-col-resize bg-transparent" />
      )}
    </div>
  );
};

export default Sidebar;
