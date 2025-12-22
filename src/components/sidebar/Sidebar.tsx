import React, { useCallback } from "react";
import { X, Layers, List, LayoutGrid, StickyNote } from "lucide-react";
import { FormField, PageData, PDFOutlineItem, Annotation } from "@/types";
import { setGlobalCursor, resetGlobalCursor, cn } from "@/lib/utils";
import FieldTreePanel from "./FieldTreePanel";
import AnnotationsPanel from "./AnnotationsPanel";
import { ThumbnailsPanel, DocumentOutlinePanel } from "./OutlinePanel";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { useLanguage } from "../language-provider";
import type { PDFDocumentProxy } from "pdfjs-dist";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isFloating?: boolean;
  pages: PageData[];
  fields: FormField[];
  annotations?: Annotation[];
  outline: PDFOutlineItem[];
  selectedId: string | null;
  onSelectControl: (id: string) => void;
  onDeleteAnnotation?: (id: string) => void;
  onUpdateAnnotation?: (id: string, updates: Partial<Annotation>) => void;
  onNavigatePage: (pageIndex: number) => void;
  width: number;
  onResize: (width: number) => void;
  pdfDocument?: PDFDocumentProxy;
  currentPageIndex?: number;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  isFloating = false,
  pages,
  fields,
  annotations = [],
  outline,
  selectedId,
  onSelectControl,
  onDeleteAnnotation = () => {},
  onUpdateAnnotation = () => {},
  onNavigatePage,
  width,
  onResize,
  pdfDocument,
  currentPageIndex,
  activeTab,
  onTabChange,
}) => {
  const { t } = useLanguage();
  const [isResizing, setIsResizing] = React.useState(false);
  const resizeStateRef = React.useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);
  const onResizeRef = React.useRef(onResize);
  onResizeRef.current = onResize;

  // Local state for uncontrolled mode if activeTab is not provided
  const [localTab, setLocalTab] = React.useState("thumbnails");
  const currentTab = activeTab !== undefined ? activeTab : localTab;
  const handleTabChange = (val: string) => {
    if (onTabChange) onTabChange(val);
    else setLocalTab(val);
  };

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeStateRef.current = { startX: e.clientX, startWidth: width };
      setIsResizing(true);
    },
    [width],
  );

  React.useEffect(() => {
    if (!isResizing) return;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeStateRef.current) return;
      const { startX, startWidth } = resizeStateRef.current;
      const newWidth = startWidth + (moveEvent.clientX - startX);
      if (onResizeRef.current) {
        onResizeRef.current(Math.max(200, Math.min(600, newWidth)));
      }
    };

    const onMouseUp = () => {
      setIsResizing(false);
      resizeStateRef.current = null;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    setGlobalCursor("col-resize", "sidebar-resize");
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      resetGlobalCursor("sidebar-resize");
      document.body.style.removeProperty("user-select");
    };
  }, [isResizing]); // Removed onResize dependency to prevent effect re-runs

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "bg-background border-border flex h-full shrink-0 flex-col border-r transition-colors duration-200",
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
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 shrink-0"
            title={t("common.close")}
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
              pdfDocument={pdfDocument}
              onNavigate={onNavigatePage}
              currentPageIndex={currentPageIndex}
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
              selectedId={selectedId}
            />
          </TabsContent>
        </div>
      </Tabs>

      {/* Resize Handle */}
      <div
        className={cn(
          "absolute top-0 right-0 bottom-0 z-50 w-1 cursor-col-resize transition-colors",
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
