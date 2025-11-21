
import React, { useState, useMemo } from 'react';
import { FormField, FieldType, PageData } from '../types';
import { ChevronRight, ChevronDown, Type, CheckSquare, FileText, Search, List, CircleDot, PenLine } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import { useLanguage } from './language-provider';

interface FieldTreePanelProps {
  pages: PageData[];
  fields: FormField[];
  selectedFieldId: string | null;
  onSelectField: (id: string) => void;
}

const FieldTreePanel: React.FC<FieldTreePanelProps> = ({
  pages,
  fields,
  selectedFieldId,
  onSelectField,
}) => {
  const { t } = useLanguage();
  const [expandedPages, setExpandedPages] = useState<Set<number>>(new Set([0]));
  const [searchTerm, setSearchTerm] = useState('');

  // Group fields by page
  const fieldsByPage = useMemo(() => {
    const grouped: Record<number, FormField[]> = {};
    pages.forEach(page => {
      grouped[page.pageIndex] = [];
    });
    fields.forEach(field => {
      if (grouped[field.pageIndex]) {
        grouped[field.pageIndex].push(field);
      }
    });
    
    // Sort fields by Y position (top to bottom) then X position (left to right)
    Object.keys(grouped).forEach(key => {
      const pageIdx = Number(key);
      grouped[pageIdx].sort((a, b) => {
        // Approximate reading order: mostly primarily by Y, secondarily by X
        // Note: Y coordinate in UI is top-down
        if (Math.abs(a.rect.y - b.rect.y) > 10) {
           return a.rect.y - b.rect.y;
        }
        return a.rect.x - b.rect.x;
      });
    });

    return grouped;
  }, [pages, fields]);

  const togglePage = (pageIndex: number) => {
    const newExpanded = new Set(expandedPages);
    if (newExpanded.has(pageIndex)) {
      newExpanded.delete(pageIndex);
    } else {
      newExpanded.add(pageIndex);
    }
    setExpandedPages(newExpanded);
  };

  const filteredPages = pages.filter(page => {
      if (!searchTerm) return true;
      // If searching, show page if it matches OR if it has matching fields
      const pageMatches = `Page ${page.pageIndex + 1}`.toLowerCase().includes(searchTerm.toLowerCase());
      const hasMatchingFields = fieldsByPage[page.pageIndex].some(f => f.name.toLowerCase().includes(searchTerm.toLowerCase()));
      return pageMatches || hasMatchingFields;
  });

  const getFieldIcon = (type: FieldType) => {
      switch(type) {
          case FieldType.CHECKBOX: return CheckSquare;
          case FieldType.RADIO: return CircleDot;
          case FieldType.DROPDOWN: return List;
          case FieldType.SIGNATURE: return PenLine;
          default: return Type;
      }
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Search */}
      <div className="p-3 border-b border-border bg-muted/30">
        <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
            <Input 
                type="text" 
                placeholder={t('sidebar.filter')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 h-8"
            />
        </div>
      </div>

      {/* Tree View */}
      <div className="flex-1 overflow-y-auto p-2">
        {filteredPages.map(page => {
           const pageFields = fieldsByPage[page.pageIndex] || [];
           // Filter fields if searching
           const visibleFields = searchTerm 
             ? pageFields.filter(f => f.name.toLowerCase().includes(searchTerm.toLowerCase()))
             : pageFields;

           if (searchTerm && visibleFields.length === 0) return null;

           const isExpanded = expandedPages.has(page.pageIndex) || !!searchTerm; // Auto-expand on search

           return (
             <div key={page.pageIndex} className="mb-1">
               <Button
                 variant="ghost"
                 size="sm"
                 onClick={() => togglePage(page.pageIndex)}
                 className="w-full justify-start px-2 h-9 font-normal"
               >
                 {isExpanded ? <ChevronDown size={14} className="mr-1 text-muted-foreground" /> : <ChevronRight size={14} className="mr-1 text-muted-foreground" />}
                 <FileText size={14} className="mr-2 text-muted-foreground" />
                 <span className="text-sm">{t('sidebar.page', { page: page.pageIndex + 1 })}</span>
                 <Badge variant="secondary" className="ml-auto px-1.5 py-0 h-5 min-w-[1.25rem] justify-center">
                    {visibleFields.length}
                 </Badge>
               </Button>

               {isExpanded && (
                 <div className="ml-4 mt-1 space-y-0.5 border-l border-border pl-1">
                   {visibleFields.length > 0 ? (
                     visibleFields.map(field => {
                       const Icon = getFieldIcon(field.type);
                       return (
                         <Button
                           key={field.id}
                           variant="ghost"
                           size="sm"
                           onClick={() => onSelectField(field.id)}
                           className={cn(
                             "w-full justify-start px-2 h-8 text-xs font-normal",
                             selectedFieldId === field.id && "bg-accent text-accent-foreground font-medium"
                           )}
                         >
                           <Icon size={12} className={cn("mr-2 flex-shrink-0", selectedFieldId === field.id ? "text-primary" : "text-muted-foreground")} />
                           <span className="truncate">{field.name}</span>
                         </Button>
                       )
                     })
                   ) : (
                       <div className="px-2 py-1 text-xs text-muted-foreground italic ml-2">{t('sidebar.no_fields')}</div>
                   )}
                 </div>
               )}
             </div>
           );
        })}
        
        {filteredPages.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
                {t('sidebar.no_results')}
            </div>
        )}
      </div>
    </div>
  );
};

export default FieldTreePanel;