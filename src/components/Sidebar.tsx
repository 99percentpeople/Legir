import React, { useCallback } from "react";
import { X, Layers, List, LayoutGrid } from "lucide-react";
import { FormField, PageData, PDFOutlineItem } from "../types";
import FieldTreePanel from "./sidebar/FieldTreePanel";
import { ThumbnailsPanel, DocumentOutlinePanel } from "./sidebar/OutlinePanel";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { useLanguage } from "./language-provider";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  pages: PageData[];
  fields: FormField[];
  annotations?: any[]; // Add this if it's passed
  outline: PDFOutlineItem[];
  selectedId: string | null;
  onSelectControl: (id: string) => void;
  onNavigatePage: (pageIndex: number) => void;
  width: number;
  onResize: (width: number) => void;
  pdfDocument?: any;
  currentPageIndex?: number;
}

const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  pages,
  fields,
  outline,
  selectedId,
  onSelectControl,
  onNavigatePage,
  width,
  onResize,
  pdfDocument,
  currentPageIndex,
}) => {
  const { t } = useLanguage();

  const resizeHandler = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const newWidth = startWidth + (moveEvent.clientX - startX);
        onResize(Math.max(200, Math.min(600, newWidth)));
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "col-resize";
      // document.body.style.userSelect = 'none';
    },
    [width, onResize],
  );

  if (!isOpen) return null;

  return (
    <div
      className="bg-background border-border relative z-20 flex h-full shrink-0 flex-col border-r transition-colors duration-200"
      style={{ width: width }}
    >
      <Tabs defaultValue="thumbnails" className="flex h-full flex-col">
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
        </div>
      </Tabs>

      {/* Resize Handle */}
      <div
        className="hover:bg-primary/50 absolute top-0 right-0 bottom-0 z-50 w-1 cursor-col-resize transition-colors"
        onMouseDown={resizeHandler}
      />
    </div>
  );
};

export default Sidebar;
