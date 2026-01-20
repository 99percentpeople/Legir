import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MessageCircle,
  Search,
  Filter,
  Calendar,
  Trash2,
  Highlighter,
  Pen,
  Type,
} from "lucide-react";
import { Annotation } from "@/types";
import { useLanguage } from "../language-provider";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { TimeText } from "../timeText";
import { Textarea } from "../ui/textarea";
import { cn } from "@/lib/cn";
import type { AppEventMap } from "@/lib/eventBus";
import { appEventBus } from "@/lib/eventBus";
import { useAppEvent } from "@/hooks/useAppEventBus";

// --- Annotation Card ---
interface AnnotationCardProps {
  annotation: Annotation;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onUpdate: (updates: Partial<Annotation>) => void;
}

const AnnotationCard: React.FC<AnnotationCardProps> = ({
  annotation,
  isSelected,
  onSelect,
  onDelete,
  onUpdate,
}) => {
  const { t } = useLanguage();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef(false);

  useAppEvent(
    "sidebar:focusAnnotation",
    (payload) => {
      if (payload.id !== annotation.id) return;
      pendingFocusRef.current = true;
    },
    { replayLast: true },
  );

  useEffect(() => {
    if (isSelected) {
      if (cardRef.current) {
        cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      }

      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLTextAreaElement &&
        activeElement !== textareaRef.current
      ) {
        activeElement.blur();
      }

      if (pendingFocusRef.current && textareaRef.current) {
        pendingFocusRef.current = false;
        textareaRef.current.focus();
        const len = textareaRef.current.value.length;
        textareaRef.current.setSelectionRange(len, len);
        appEventBus.clearSticky("sidebar:focusAnnotation");
      }
    }
  }, [isSelected]);

  const getIcon = () => {
    if (annotation.type === "ink" && annotation.intent === "InkHighlight") {
      return <Highlighter size={12} className="text-muted-foreground" />;
    }
    switch (annotation.type) {
      case "highlight":
        return <Highlighter size={12} className="text-muted-foreground" />;
      case "ink":
        return <Pen size={12} className="text-muted-foreground" />;
      case "freetext":
        return <Type size={12} className="text-muted-foreground" />;
      default:
        return <MessageCircle size={12} className="text-muted-foreground" />;
    }
  };

  return (
    <div
      ref={cardRef}
      id={`annotation-card-${annotation.id}`}
      className={cn(
        "group relative rounded-l-lg rounded-r-lg border-none transition-all",
        isSelected
          ? "ring-primary/80 shadow-md ring-1"
          : "hover:ring-primary/50 hover:shadow-sm hover:ring-1",
      )}
      style={{
        backgroundColor: annotation.color || "#000000",
      }}
      onClick={onSelect}
    >
      <div
        className={cn(
          "border-border ml-1 flex flex-col gap-1 rounded-l-md rounded-r-lg border p-2",
          "bg-background/90",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            {getIcon()}
            <span className="max-w-[120px] truncate">{annotation.author}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 px-0 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 size={12} className="text-destructive" />
          </Button>
        </div>

        <Textarea
          id={`annotation-input-${annotation.id}`}
          ref={textareaRef}
          className="text-foreground placeholder:text-muted-foreground/50 min-h-[60px] w-full resize-none border-none bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
          value={annotation.text || ""}
          placeholder={t("sidebar.add_remark")}
          onChange={(e) =>
            onUpdate({
              text: e.target.value,
            })
          }
          onClick={(e) => e.stopPropagation()}
        />
        {annotation.updatedAt && (
          <div className="border-border/50 text-muted-foreground mt-2 flex items-center justify-between border-t pt-2 text-[10px]">
            <span className="flex items-center gap-1">
              <Calendar size={10} />
              <TimeText time={annotation.updatedAt} format="LLL" />
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Annotations Panel ---
interface AnnotationsProps {
  annotations: Annotation[];
  onSelectControl: (
    id: string,
    options?: Omit<AppEventMap["workspace:focusControl"], "id">,
  ) => void;
  onDeleteAnnotation: (id: string) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  selectedId: string | null;
}

const AnnotationsPanel: React.FC<AnnotationsProps> = ({
  annotations,
  onSelectControl,
  onDeleteAnnotation,
  onUpdateAnnotation,
  selectedId,
}) => {
  const { t } = useLanguage();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([
    "comment",
    "highlight",
    "ink",
    "freetext",
  ]);
  // Include all annotation types that we want to display
  const allAnnotations = useMemo(
    () =>
      annotations.filter((a) =>
        ["comment", "highlight", "ink", "freetext"].includes(a.type),
      ),
    [annotations],
  );

  // Filter based on type and search term
  const filteredAnnotations = useMemo(() => {
    return allAnnotations.filter((annot) => {
      const effectiveType =
        annot.type === "ink" && annot.intent === "InkHighlight"
          ? "highlight"
          : annot.type;

      // Type filter
      if (!selectedTypes.includes(effectiveType)) return false;

      // Search filter
      if (!searchTerm) return true;
      const textContent = annot.text || "";
      const authorContent = annot.author || "";
      const searchLower = searchTerm.toLowerCase();

      return (
        textContent.toLowerCase().includes(searchLower) ||
        authorContent.toLowerCase().includes(searchLower)
      );
    });
  }, [allAnnotations, searchTerm, selectedTypes]);

  const sortedAnnotations = useMemo(() => {
    return filteredAnnotations.slice().sort((a, b) => {
      if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;

      const ay = a.rect?.y ?? 0;
      const by = b.rect?.y ?? 0;
      const ax = a.rect?.x ?? 0;
      const bx = b.rect?.x ?? 0;

      if (Math.abs(ay - by) > 10) return ay - by;
      return ax - bx;
    });
  }, [filteredAnnotations]);

  // Group by page
  const groupedAnnotations = useMemo(() => {
    const acc: Record<number, Annotation[]> = {};
    for (const annot of sortedAnnotations) {
      const page = annot.pageIndex + 1;
      if (!acc[page]) acc[page] = [];
      acc[page].push(annot);
    }
    return acc;
  }, [sortedAnnotations]);

  const sortedPages = useMemo(() => {
    return Object.keys(groupedAnnotations)
      .map(Number)
      .sort((a, b) => a - b);
  }, [groupedAnnotations]);

  const handleSelect = (annot: Annotation) => {
    const id = annot.id;
    onSelectControl(id, {
      behavior: "smooth",
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-border bg-muted/30 flex shrink-0 items-center gap-2 border-b p-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
          <Input
            type="text"
            placeholder={t("sidebar.search_annotations")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-background h-8 w-full pl-8 text-xs"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={selectedTypes.length !== 3 ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              title={t("sidebar.filter")}
            >
              <Filter className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[200px]">
            <DropdownMenuCheckboxItem
              checked={selectedTypes.includes("comment")}
              onCheckedChange={(checked) => {
                if (checked) setSelectedTypes([...selectedTypes, "comment"]);
                else
                  setSelectedTypes(
                    selectedTypes.filter((t) => t !== "comment"),
                  );
              }}
            >
              {t("toolbar.comment")}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={selectedTypes.includes("highlight")}
              onCheckedChange={(checked) => {
                if (checked) setSelectedTypes([...selectedTypes, "highlight"]);
                else
                  setSelectedTypes(
                    selectedTypes.filter((t) => t !== "highlight"),
                  );
              }}
            >
              {t("toolbar.highlight")}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={selectedTypes.includes("ink")}
              onCheckedChange={(checked) => {
                if (checked) setSelectedTypes([...selectedTypes, "ink"]);
                else setSelectedTypes(selectedTypes.filter((t) => t !== "ink"));
              }}
            >
              {t("toolbar.ink")}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={selectedTypes.includes("freetext")}
              onCheckedChange={(checked) => {
                if (checked) setSelectedTypes([...selectedTypes, "freetext"]);
                else
                  setSelectedTypes(
                    selectedTypes.filter((t) => t !== "freetext"),
                  );
              }}
            >
              {t("toolbar.freetext")}
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <h3 className="flex items-center gap-2 px-2 pt-2 text-sm font-semibold">
        {t(
          allAnnotations.length === filteredAnnotations.length
            ? "sidebar.all_annotations"
            : "sidebar.all_annotations_filtered",
          {
            total: allAnnotations.length,
            filtered: filteredAnnotations.length,
          },
        )}
      </h3>
      <div className="flex-1 overflow-auto">
        <div className="space-y-6 p-2">
          {filteredAnnotations.length === 0 ? (
            <div className="text-muted-foreground py-6 text-center text-sm italic">
              {searchTerm || selectedTypes.length < 3
                ? t("sidebar.no_results")
                : t("sidebar.no_annotations")}
            </div>
          ) : (
            sortedPages.map((page) => (
              <div key={page} className="space-y-2">
                <div className="text-muted-foreground bg-background sticky top-0 z-10 py-1 text-xs font-medium">
                  {t("sidebar.page", { page })}
                </div>
                <div className="space-y-3">
                  {groupedAnnotations[page].map((annot) => (
                    <AnnotationCard
                      key={annot.id}
                      annotation={annot}
                      isSelected={selectedId === annot.id}
                      onSelect={() => handleSelect(annot)}
                      onDelete={() => onDeleteAnnotation(annot.id)}
                      onUpdate={(updates) =>
                        onUpdateAnnotation(annot.id, updates)
                      }
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default AnnotationsPanel;
