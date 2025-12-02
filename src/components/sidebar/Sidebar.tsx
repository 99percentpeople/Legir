
import React, { useCallback } from 'react';
import { X, Layers, List, LayoutGrid } from 'lucide-react';
import { FormField, PageData, PDFOutlineItem } from '../../types';
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

  const resizeHandler = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = startWidth + (moveEvent.clientX - startX);
      onResize(Math.max(200, Math.min(600, newWidth)));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width, onResize]);

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
        className="absolute top-0 right-0 bottom-0 w-1 hover:bg-primary/50 cursor-col-resize z-50 transition-colors"
        onMouseDown={resizeHandler}
      />
    </div>
  );
};

export default Sidebar;
