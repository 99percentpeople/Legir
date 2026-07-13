import React from "react";
import { X, Layers, List, LayoutGrid, StickyNote } from "lucide-react";
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
import { appEventBus } from "@/lib/eventBus";
import { useEditorStore } from "@/store/useEditorStore";
import { selectSidebarState } from "@/store/selectors";
import { useShallow } from "zustand/react/shallow";
import {
  useEditorPdfSearch,
  useEditorShellCommands,
} from "@/app/editorShellContext";
import PDFSearchHeader from "./PDFSearchHeader";
import PDFSearchPanel from "./PDFSearchPanel";

const Sidebar: React.FC = () => {
  const { t } = useLanguage();
  const state = useEditorStore(useShallow(selectSidebarState));
  const {
    isOpen,
    isFloating,
    pages,
    fields,
    annotations,
    documentPermissions,
    outline,
    selectedId,
    currentPageIndex,
    thumbnailsLayout,
    sidebarTab,
    width,
    setUiState,
    selectControl,
    deleteAnnotation,
    updateAnnotation,
    addAnnotationReply,
    updateAnnotationReply,
    deleteAnnotationReply,
  } = state;
  const { openSidebar: onOpen } = useEditorShellCommands();
  const search = useEditorPdfSearch();
  const onClose = () => setUiState({ isSidebarOpen: false });
  const onResize = (nextWidth: number) =>
    setUiState({ sidebarWidth: nextWidth });
  const onNavigatePage = (pageIndex: number) => {
    appEventBus.emit("workspace:navigatePage", {
      pageIndex,
      behavior: "smooth",
    });
  };
  const onSelectControl = (
    id: string,
    options?: { behavior?: "auto" | "smooth"; skipScroll?: boolean },
  ) => {
    selectControl(id);
    appEventBus.emit(
      "workspace:focusControl",
      { id, behavior: options?.behavior, skipScroll: options?.skipScroll },
      { sticky: true },
    );
  };
  const normalizedSidebarTab =
    sidebarTab === "search" ? "thumbnails" : sidebarTab;
  const activeTab = search.isPdfSearchOpen ? "search" : normalizedSidebarTab;
  const isSearchActive = search.isPdfSearchOpen;

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

  const currentTab = activeTab;
  const handleTabChange = (val: string) => {
    search.dismissPdfSearch();
    setUiState({ sidebarTab: val });
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
          {isSearchActive ? (
            <PDFSearchHeader
              query={search.pdfSearchQuery}
              focusToken={search.pdfSearchFocusToken}
              hasResults={search.pdfSearchResults.length > 0}
              onQueryChange={search.setPdfSearchQuery}
              onPrevious={search.handleSelectPreviousPdfSearchResult}
              onNext={search.handleSelectNextPdfSearchResult}
            />
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
            onClick={isSearchActive ? search.closePdfSearch : onClose}
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
              documentPermissions={documentPermissions}
              onSelectControl={onSelectControl}
              onDeleteAnnotation={deleteAnnotation}
              onUpdateAnnotation={updateAnnotation}
              onAddAnnotationReply={addAnnotationReply}
              onUpdateAnnotationReply={updateAnnotationReply}
              onDeleteAnnotationReply={deleteAnnotationReply}
              selectedId={selectedId}
            />
          </TabsContent>
          {isSearchActive ? (
            <TabsContent
              value="search"
              className="mt-0 flex h-full flex-1 flex-col data-[state=inactive]:hidden"
            >
              <PDFSearchPanel
                query={search.pdfSearchQuery}
                mode={search.pdfSearchMode}
                caseSensitive={search.isPdfSearchCaseSensitive}
                results={search.pdfSearchResults}
                activeResultId={search.activePdfSearchResultId}
                activeResultIndex={search.activePdfSearchResultIndex}
                isSearching={search.isPdfSearchLoading}
                errorMessage={search.pdfSearchError}
                onToggleCaseSensitive={search.togglePdfSearchCaseSensitive}
                onToggleRegex={search.togglePdfSearchMode}
                onSelectResult={search.handleSelectPdfSearchResult}
              />
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
