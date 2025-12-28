import React, { useState, useEffect, useRef } from "react";
import { PDFOutlineItem, PageData } from "../../types";
import { ChevronRight, ChevronDown, Book, File, Search } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "../../lib/cn";
import { useLanguage } from "../language-provider";

// --- Outline Item ---
interface OutlineItemProps {
  item: PDFOutlineItem;
  onNavigate: (pageIndex: number) => void;
  depth?: number;
  searchQuery?: string;
  isActive?: boolean;
  activeOutlineItem?: PDFOutlineItem | null;
}

const OutlineItem: React.FC<OutlineItemProps> = ({
  item,
  onNavigate,
  depth = 0,
  searchQuery,
  isActive,
  activeOutlineItem,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasChildren = item.items && item.items.length > 0;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && ref.current) {
      // Scroll into view, but maybe only if not already visible?
      // 'nearest' tries to minimize scrolling.
      ref.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
          return itm.items.some((child) => containsActive(child));
        }
        return false;
      };

      // If one of my children (direct or deep) is the active item, I should expand.
      if (item.items && item.items.some((child) => containsActive(child))) {
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
          "hover:bg-accent hover:text-accent-foreground h-auto w-full justify-start px-2 py-1.5 font-normal",
          isActive && "bg-accent text-accent-foreground font-medium",
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleTitleClick}
      >
        <span
          onClick={toggleExpand}
          className={cn(
            "hover:bg-muted mr-1 rounded p-0.5",
            hasChildren ? "visible" : "invisible",
          )}
        >
          {isExpanded ? (
            <ChevronDown size={14} className="text-muted-foreground" />
          ) : (
            <ChevronRight size={14} className="text-muted-foreground" />
          )}
        </span>

        {item.pageIndex !== undefined ? (
          <File
            size={14}
            className={cn(
              "mr-2 shrink-0",
              isActive ? "text-primary" : "text-muted-foreground",
            )}
          />
        ) : (
          <Book size={14} className="text-muted-foreground mr-2 shrink-0" />
        )}

        <span
          className={cn(
            "truncate",
            item.pageIndex !== undefined
              ? "underline decoration-dotted underline-offset-4"
              : "",
          )}
        >
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
const filterOutline = (
  items: PDFOutlineItem[],
  query: string,
): PDFOutlineItem[] => {
  if (!query) return items;
  const lowerQuery = query.toLowerCase();

  return items.reduce((acc: PDFOutlineItem[], item) => {
    const matches = item.title.toLowerCase().includes(lowerQuery);
    const filteredChildren = filterOutline(item.items, query);

    if (matches || filteredChildren.length > 0) {
      acc.push({
        ...item,
        items: filteredChildren, // Keep hierarchy if children match
      });
    }
    return acc;
  }, []);
};

interface DocumentOutlinePanelProps {
  outline: PDFOutlineItem[];
  onNavigate: (pageIndex: number) => void;
  currentPageIndex?: number;
}

export const DocumentOutlinePanel: React.FC<DocumentOutlinePanelProps> = ({
  outline,
  onNavigate,
  currentPageIndex,
}) => {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredOutline = React.useMemo(
    () => filterOutline(outline, searchQuery),
    [outline, searchQuery],
  );

  // Calculate active item
  const activeOutlineItem = React.useMemo(() => {
    if (currentPageIndex === undefined) return null;
    let bestMatch: PDFOutlineItem | null = null;
    const traverse = (items: PDFOutlineItem[]) => {
      for (const item of items) {
        if (
          item.pageIndex !== undefined &&
          item.pageIndex <= currentPageIndex
        ) {
          // We want the item closest to the current page (but not after it)
          if (!bestMatch || item.pageIndex > (bestMatch.pageIndex || -1)) {
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
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <div className="border-border bg-muted/30 shrink-0 border-b p-2">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
          <Input
            placeholder={t("sidebar.search_outline")}
            className="bg-background h-8 w-full pl-8 text-xs"
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
          <div className="text-muted-foreground p-6 text-center text-sm italic">
            {searchQuery ? t("sidebar.no_results") : t("sidebar.no_outline")}
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentOutlinePanel;
