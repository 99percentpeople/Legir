import React, { useState, useEffect, useRef } from 'react';
import { PDFOutlineItem, PageData } from '../../types';
import { ChevronRight, ChevronDown, Book, File, Search, Image as ImageIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import { useLanguage } from '../language-provider';
import { renderPageToDataURL } from '../../services/pdfService';

// --- Thumbnail Item ---
interface ThumbnailItemProps {
  page: PageData;
  pageIndex: number;
  pdfDocument: any;
  onNavigate: (pageIndex: number) => void;
  isActive?: boolean;
}

const ThumbnailItem: React.FC<ThumbnailItemProps> = ({ page, pageIndex, pdfDocument, onNavigate, isActive }) => {
  const { t } = useLanguage();
  const [imageUrl, setImageUrl] = useState<string | null>(page.imageData || null);
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isActive]);

  useEffect(() => {
      const observer = new IntersectionObserver(([entry]) => {
          if (entry.isIntersecting) {
              setIsVisible(true);
              observer.disconnect();
          }
      });
      if (ref.current) observer.observe(ref.current);
      return () => observer.disconnect();
  }, []);

  useEffect(() => {
      if (isVisible && !imageUrl && pdfDocument) {
          // Increased scale from 0.2 to 0.6 for better quality in single column view
          renderPageToDataURL(pdfDocument, pageIndex, 0.6).then(url => {
              if (url) setImageUrl(url);
          });
      }
  }, [isVisible, imageUrl, pdfDocument, pageIndex]);

  const aspectRatio = page.width && page.height ? page.width / page.height : 0.75;

  return (
      <div 
        ref={ref} 
        className={cn(
          "flex flex-col items-center gap-2 p-2 cursor-pointer hover:bg-accent/50 rounded-md group transition-colors",
          isActive && "bg-accent"
        )}
        onClick={() => onNavigate(pageIndex)}
      >
          <div 
            className={cn(
              "border shadow-sm bg-white w-full relative overflow-hidden rounded-sm group-hover:shadow-md transition-all group-hover:ring-2 group-hover:ring-primary/20",
              isActive && "ring-2 ring-primary shadow-md"
            )}
            style={{ aspectRatio: aspectRatio }}
          >
              {imageUrl ? (
                  <img src={imageUrl} alt={`Page ${pageIndex + 1}`} className="w-full h-full object-contain" />
              ) : (
                  <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
                      <ImageIcon size={20} className="opacity-20" />
                  </div>
              )}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />
          </div>
          <span className="text-xs text-muted-foreground font-medium">{t('sidebar.page', { page: pageIndex + 1 })}</span>
      </div>
  );
};

// --- Outline Item ---
interface OutlineItemProps {
  item: PDFOutlineItem;
  onNavigate: (pageIndex: number) => void;
  depth?: number;
  searchQuery?: string;
  isActive?: boolean;
  activeOutlineItem?: PDFOutlineItem | null;
}

const OutlineItem: React.FC<OutlineItemProps> = ({ item, onNavigate, depth = 0, searchQuery, isActive, activeOutlineItem }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasChildren = item.items && item.items.length > 0;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && ref.current) {
        // Scroll into view, but maybe only if not already visible?
        // 'nearest' tries to minimize scrolling.
        ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isActive]);
  
  // Auto-expand if matches search or children match search
  // Also expand if a child is active!
  useEffect(() => {
    if (searchQuery) {
       setIsExpanded(true);
    }
  }, [searchQuery]);

  // Check if any child is the active item to auto-expand
  useEffect(() => {
      if (activeOutlineItem) {
          // Helper to check if this item contains the active item in its subtree
          const containsActive = (itm: PDFOutlineItem): boolean => {
              if (itm === activeOutlineItem) return true;
              if (itm.items) {
                  return itm.items.some(child => containsActive(child));
              }
              return false;
          };
          
          // If one of my children (direct or deep) is the active item, I should expand.
          if (item.items && item.items.some(child => containsActive(child))) {
              setIsExpanded(true);
          }
      }
  }, [activeOutlineItem, item]);

  const handleTitleClick = () => {
      if (item.pageIndex !== undefined) {
          onNavigate(item.pageIndex);
      } else if (hasChildren) {
          setIsExpanded(!isExpanded);
      }
  };

  const toggleExpand = (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsExpanded(!isExpanded);
  };

  // Simple search highlight logic could be added here, but for now we just filter at parent level
  // Actually, filtering a tree is tricky. We usually show the path to the match.
  // If we just filter at render time, we need to know if this item or any child matches.
  
  return (
    <div ref={ref}>
      <Button 
        variant="ghost"
        size="sm"
        className={cn(
          "w-full justify-start h-auto py-1.5 px-2 font-normal hover:bg-accent hover:text-accent-foreground",
          isActive && "bg-accent text-accent-foreground font-medium"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleTitleClick}
      >
        <span 
            onClick={toggleExpand}
            className={cn("p-0.5 rounded mr-1 hover:bg-muted", hasChildren ? 'visible' : 'invisible')}
        >
            {isExpanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
        </span>
        
        {item.pageIndex !== undefined ? (
            <File size={14} className={cn("mr-2 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
        ) : (
            <Book size={14} className="mr-2 text-muted-foreground shrink-0" />
        )}
        
        <span className={cn("truncate", item.pageIndex !== undefined ? 'underline decoration-dotted underline-offset-4' : '')}>
            {item.title}
        </span>
      </Button>
      
      {isExpanded && hasChildren && (
        <div>
          {item.items.map((child, idx) => (
            <OutlineItem 
                key={idx} 
                item={child} 
                onNavigate={onNavigate} 
                depth={depth + 1} 
                searchQuery={searchQuery}
                isActive={child === activeOutlineItem}
                activeOutlineItem={activeOutlineItem}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Helper to filter outline tree
const filterOutline = (items: PDFOutlineItem[], query: string): PDFOutlineItem[] => {
  if (!query) return items;
  const lowerQuery = query.toLowerCase();
  
  return items.reduce((acc: PDFOutlineItem[], item) => {
    const matches = item.title.toLowerCase().includes(lowerQuery);
    const filteredChildren = filterOutline(item.items, query);
    
    if (matches || filteredChildren.length > 0) {
      acc.push({
        ...item,
        items: filteredChildren // Keep hierarchy if children match
      });
    }
    return acc;
  }, []);
};


interface ThumbnailsPanelProps {
  pages?: PageData[];
  pdfDocument?: any;
  onNavigate: (pageIndex: number) => void;
  currentPageIndex?: number;
}

export const ThumbnailsPanel: React.FC<ThumbnailsPanelProps> = ({ pages, pdfDocument, onNavigate, currentPageIndex }) => {
  const { t } = useLanguage();
  
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-2 pb-10">
          <div className="grid grid-cols-1 gap-4">
              {pages?.map((page, idx) => (
                  <ThumbnailItem 
                    key={idx} 
                    page={page} 
                    pageIndex={idx} 
                    pdfDocument={pdfDocument} 
                    onNavigate={onNavigate} 
                    isActive={idx === currentPageIndex}
                  />
              ))}
              {(!pages || pages.length === 0) && (
                  <div className="p-6 text-center text-muted-foreground text-sm italic">
                      {t('sidebar.no_pages')}
                  </div>
              )}
          </div>
      </div>
    </div>
  );
};

interface DocumentOutlinePanelProps {
  outline: PDFOutlineItem[];
  onNavigate: (pageIndex: number) => void;
  currentPageIndex?: number;
}

export const DocumentOutlinePanel: React.FC<DocumentOutlinePanelProps> = ({ outline, onNavigate, currentPageIndex }) => {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredOutline = React.useMemo(() => 
    filterOutline(outline, searchQuery), 
    [outline, searchQuery]
  );

  // Calculate active item
  const activeOutlineItem = React.useMemo(() => {
      if (currentPageIndex === undefined) return null;
      let bestMatch: PDFOutlineItem | null = null;
      const traverse = (items: PDFOutlineItem[]) => {
          for (const item of items) {
              if (item.pageIndex !== undefined && item.pageIndex <= currentPageIndex) {
                  // We want the item closest to the current page (but not after it)
                  if (!bestMatch || (item.pageIndex > (bestMatch.pageIndex || -1))) {
                      bestMatch = item;
                  }
              }
              if (item.items) traverse(item.items);
          }
      };
      traverse(outline);
      return bestMatch;
  }, [outline, currentPageIndex]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
       <div className="p-2 border-b border-border bg-muted/30 shrink-0">
          <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground h-3.5 w-3.5" />
              <Input 
                  placeholder={t('sidebar.search_outline')}
                  className="h-8 pl-8 text-xs w-full bg-background"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
              />
           </div>
       </div>
       <div className="flex-1 overflow-y-auto p-2 pb-10">
          {filteredOutline.length > 0 ? (
             filteredOutline.map((item, idx) => (
               <OutlineItem 
                  key={idx} 
                  item={item} 
                  onNavigate={onNavigate} 
                  searchQuery={searchQuery} 
                  isActive={item === activeOutlineItem}
                  activeOutlineItem={activeOutlineItem}
              />
             ))
          ) : (
             <div className="p-6 text-center text-muted-foreground text-sm italic">
                {searchQuery ? t('sidebar.no_results') : t('sidebar.no_outline')}
             </div>
          )}
       </div>
    </div>
  );
};

