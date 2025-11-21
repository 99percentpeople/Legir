import React, { useState } from 'react';
import { PDFOutlineItem } from '../types';
import { ChevronRight, ChevronDown, Book, File } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

interface OutlineItemProps {
  item: PDFOutlineItem;
  onNavigate: (pageIndex: number) => void;
  depth?: number;
}

const OutlineItem: React.FC<OutlineItemProps> = ({ item, onNavigate, depth = 0 }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasChildren = item.items && item.items.length > 0;

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

  return (
    <div>
      <Button 
        variant="ghost"
        size="sm"
        className="w-full justify-start h-auto py-1.5 px-2 font-normal hover:bg-accent hover:text-accent-foreground"
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
            <File size={14} className="mr-2 text-primary flex-shrink-0" />
        ) : (
            <Book size={14} className="mr-2 text-muted-foreground flex-shrink-0" />
        )}
        
        <span className={cn("truncate", item.pageIndex !== undefined ? 'underline decoration-dotted underline-offset-4' : '')}>
            {item.title}
        </span>
      </Button>
      
      {isExpanded && hasChildren && (
        <div>
          {item.items.map((child, idx) => (
            <OutlineItem key={idx} item={child} onNavigate={onNavigate} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

interface OutlinePanelProps {
  outline: PDFOutlineItem[];
  onNavigate: (pageIndex: number) => void;
}

const OutlinePanel: React.FC<OutlinePanelProps> = ({ outline, onNavigate }) => {
  if (!outline || outline.length === 0) {
      return (
          <div className="p-6 text-center text-muted-foreground text-sm italic">
              No outline found in this document.
          </div>
      );
  }

  return (
    <div className="flex-1 overflow-y-auto p-2 pb-10">
      {outline.map((item, idx) => (
        <OutlineItem key={idx} item={item} onNavigate={onNavigate} />
      ))}
    </div>
  );
};

export default OutlinePanel;