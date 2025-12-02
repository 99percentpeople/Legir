
import React, { useCallback } from 'react';
import { X, Layers, List, LayoutGrid } from 'lucide-react';
import { FormField, PageData, PDFOutlineItem } from '../../types';
import { setGlobalCursor, resetGlobalCursor, cn } from '../../lib/utils';
import FieldTreePanel from './FieldTreePanel';
import { ThumbnailsPanel, DocumentOutlinePanel } from './OutlinePanel';
import { Button } from '../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { useLanguage } from '../language-provider';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  pages: PageData[];
  fields: FormField[];
  outline: PDFOutlineItem[];
  selectedFieldId: string | null;
  onSelectField: (id: string) => void;
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
  selectedFieldId,
  onSelectField,
  onNavigatePage,
  width,
  onResize,
  pdfDocument,
  currentPageIndex
}) => {
  const { t } = useLanguage();
  const [isResizing, setIsResizing] = React.useState(false);
  const resizeStateRef = React.useRef<{ startX: number, startWidth: number } | null>(null);
  const onResizeRef = React.useRef(onResize);
  onResizeRef.current = onResize;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeStateRef.current = { startX: e.clientX, startWidth: width };
    setIsResizing(true);
  }, [width]);

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

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    setGlobalCursor('col-resize', 'sidebar-resize');
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      resetGlobalCursor('sidebar-resize');
      document.body.style.removeProperty('user-select');
    };
  }, [isResizing]); // Removed onResize dependency to prevent effect re-runs

  if (!isOpen) return null;

  return (
    <div 
      className="flex flex-col bg-background border-r border-border h-full transition-colors duration-200 shrink-0 z-20 relative"
      style={{ width: width }}
    >
      <Tabs defaultValue="thumbnails" className="flex flex-col h-full">
        {/* Header */}
        <div className="p-2 flex items-center justify-between bg-muted/30 border-b border-border shrink-0 gap-2">
           <TabsList className="flex-1 h-8 flex justify-end">
              <TabsTrigger value="thumbnails" className="text-xs h-full w-9 p-0 data-[state=active]:bg-muted" title={t('sidebar.thumbnails')}>
                  <LayoutGrid size={16} />
              </TabsTrigger>
              <TabsTrigger value="outline" className="text-xs h-full w-9 p-0 data-[state=active]:bg-muted" title={t('sidebar.outline')}>
                  <List size={16} />
              </TabsTrigger>
              <TabsTrigger value="fields" className="text-xs h-full w-9 p-0 data-[state=active]:bg-muted" title={t('sidebar.fields')}>
                  <Layers size={16} />
              </TabsTrigger>
           </TabsList>
           <Button 
            variant="ghost" 
            size="icon"
            onClick={onClose}
            className="h-8 w-8 shrink-0"
            title={t('common.close')}
          >
            <X size={16} />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col relative">
            <TabsContent value="thumbnails" className="flex-1 flex flex-col h-full mt-0 data-[state=inactive]:hidden">
                <ThumbnailsPanel 
                  pages={pages}
                  pdfDocument={pdfDocument}
                  onNavigate={onNavigatePage}
                  currentPageIndex={currentPageIndex}
                />
            </TabsContent>
            <TabsContent value="outline" className="flex-1 flex flex-col h-full mt-0 data-[state=inactive]:hidden">
                <DocumentOutlinePanel 
                  outline={outline} 
                  onNavigate={onNavigatePage}
                  currentPageIndex={currentPageIndex}
                />
            </TabsContent>
            <TabsContent value="fields" className="flex-1 flex flex-col h-full mt-0 data-[state=inactive]:hidden">
                <FieldTreePanel
                  pages={pages}
                  fields={fields}
                  selectedFieldId={selectedFieldId}
                  onSelectField={onSelectField}
                />
            </TabsContent>
        </div>
      </Tabs>

      {/* Resize Handle */}
      <div 
        className={cn(
          "absolute top-0 right-0 bottom-0 w-1 cursor-col-resize z-50 transition-colors",
          isResizing ? "bg-primary/50" : "hover:bg-primary/50"
        )}
        onMouseDown={handleMouseDown}
      />

      {/* Resize Overlay */}
      {isResizing && (
        <div className="fixed inset-0 z-[9999] cursor-col-resize bg-transparent" />
      )}
    </div>
  );
};

export default Sidebar;
