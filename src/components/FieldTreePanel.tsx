import React, { useState, useMemo } from "react";
import { FormField, FieldType, PageData } from "../types";
import {
  ChevronRight,
  ChevronDown,
  Type,
  CheckSquare,
  FileText,
  Search,
  List,
  CircleDot,
  PenLine,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";
import { useLanguage } from "./language-provider";

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
  const [searchTerm, setSearchTerm] = useState("");

  // Group fields by page
  const fieldsByPage = useMemo(() => {
    const grouped: Record<number, FormField[]> = {};
    pages.forEach((page) => {
      grouped[page.pageIndex] = [];
    });
    fields.forEach((field) => {
      if (grouped[field.pageIndex]) {
        grouped[field.pageIndex].push(field);
      }
    });

    // Sort fields by Y position (top to bottom) then X position (left to right)
    Object.keys(grouped).forEach((key) => {
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

  const filteredPages = pages.filter((page) => {
    if (!searchTerm) return true;
    // If searching, show page if it matches OR if it has matching fields
    const pageMatches = `Page ${page.pageIndex + 1}`
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const hasMatchingFields = fieldsByPage[page.pageIndex].some((f) =>
      f.name.toLowerCase().includes(searchTerm.toLowerCase()),
    );
    return pageMatches || hasMatchingFields;
  });

  const getFieldIcon = (type: FieldType) => {
    switch (type) {
      case FieldType.CHECKBOX:
        return CheckSquare;
      case FieldType.RADIO:
        return CircleDot;
      case FieldType.DROPDOWN:
        return List;
      case FieldType.SIGNATURE:
        return PenLine;
      default:
        return Type;
    }
  };

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      {/* Search */}
      <div className="border-border bg-muted/30 shrink-0 border-b p-2">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
          <Input
            type="text"
            placeholder={t("sidebar.filter")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-background h-8 w-full pl-8 text-xs"
          />
        </div>
      </div>

      {/* Tree View */}
      <div className="flex-1 overflow-y-auto p-2">
        {filteredPages.map((page) => {
          const pageFields = fieldsByPage[page.pageIndex] || [];
          // Filter fields if searching
          const visibleFields = searchTerm
            ? pageFields.filter((f) =>
                f.name.toLowerCase().includes(searchTerm.toLowerCase()),
              )
            : pageFields;

          if (searchTerm && visibleFields.length === 0) return null;

          const isExpanded = expandedPages.has(page.pageIndex) || !!searchTerm; // Auto-expand on search

          return (
            <div key={page.pageIndex} className="mb-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => togglePage(page.pageIndex)}
                className="h-9 w-full justify-start px-2 font-normal"
              >
                {isExpanded ? (
                  <ChevronDown
                    size={14}
                    className="text-muted-foreground mr-1"
                  />
                ) : (
                  <ChevronRight
                    size={14}
                    className="text-muted-foreground mr-1"
                  />
                )}
                <FileText size={14} className="text-muted-foreground mr-2" />
                <span className="text-sm">
                  {t("sidebar.page", { page: page.pageIndex + 1 })}
                </span>
                <Badge
                  variant="secondary"
                  className="ml-auto h-5 min-w-5 justify-center px-1.5 py-0"
                >
                  {visibleFields.length}
                </Badge>
              </Button>

              {isExpanded && (
                <div className="border-border mt-1 ml-4 space-y-0.5 border-l pl-1">
                  {visibleFields.length > 0 ? (
                    visibleFields.map((field) => {
                      const Icon = getFieldIcon(field.type);
                      return (
                        <Button
                          key={field.id}
                          variant="ghost"
                          size="sm"
                          onClick={() => onSelectField(field.id)}
                          className={cn(
                            "h-8 w-full justify-start px-2 text-xs font-normal",
                            selectedFieldId === field.id &&
                              "bg-accent text-accent-foreground font-medium",
                          )}
                        >
                          <Icon
                            size={12}
                            className={cn(
                              "mr-2 shrink-0",
                              selectedFieldId === field.id
                                ? "text-primary"
                                : "text-muted-foreground",
                            )}
                          />
                          <span className="truncate">{field.name}</span>
                        </Button>
                      );
                    })
                  ) : (
                    <div className="text-muted-foreground ml-2 px-2 py-1 text-xs italic">
                      {t("sidebar.no_fields")}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filteredPages.length === 0 && (
          <div className="text-muted-foreground py-8 text-center text-sm">
            {t("sidebar.no_results")}
          </div>
        )}
      </div>
    </div>
  );
};

export default FieldTreePanel;
