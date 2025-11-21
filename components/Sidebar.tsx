
import React from 'react';
import { X, Layers, ListTree } from 'lucide-react';
import { FormField, PageData, PDFOutlineItem } from '../types';
import FieldTreePanel from './FieldTreePanel';
import OutlinePanel from './OutlinePanel';
import { Button } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  pages: PageData[];
  fields: FormField[];
  outline: PDFOutlineItem[];
  selectedFieldId: string | null;
  onSelectField: (id: string) => void;
  onNavigatePage: (pageIndex: number) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  pages,
  fields,
  outline,
  selectedFieldId,
  onSelectField,
  onNavigatePage
}) => {
  if (!isOpen) return null;

  return (
    <div className="w-64 flex flex-col bg-background border-r border-border h-full transition-colors duration-200 flex-shrink-0 z-20">
      <Tabs defaultValue="fields" className="flex flex-col h-full">
        {/* Header */}
        <div className="p-2 flex items-center justify-between bg-muted/30 border-b border-border shrink-0 gap-2">
           <TabsList className="flex-1 h-8 grid grid-cols-2">
              <TabsTrigger value="fields" className="text-xs gap-2 h-full">
                  <Layers size={14} />
                  Fields
              </TabsTrigger>
              <TabsTrigger value="outline" className="text-xs gap-2 h-full">
                  <ListTree size={14} />
                  Outline
              </TabsTrigger>
           </TabsList>
           <Button 
            variant="ghost" 
            size="icon"
            onClick={onClose}
            className="h-8 w-8 shrink-0"
            title="Close Sidebar"
          >
            <X size={16} />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col relative">
            <TabsContent value="fields" className="flex-1 flex flex-col h-full mt-0 data-[state=inactive]:hidden">
                <FieldTreePanel
                  pages={pages}
                  fields={fields}
                  selectedFieldId={selectedFieldId}
                  onSelectField={onSelectField}
                />
            </TabsContent>
            <TabsContent value="outline" className="flex-1 flex flex-col h-full mt-0 data-[state=inactive]:hidden">
                <OutlinePanel 
                  outline={outline} 
                  onNavigate={onNavigatePage}
                />
            </TabsContent>
        </div>
      </Tabs>
    </div>
  );
};

export default Sidebar;
