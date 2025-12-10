import React, { useState } from "react";
import { MessageCircle, Search, Filter } from "lucide-react";
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
import AnnotationCard from "./AnnotationCard";

interface AnnotationsProps {
  annotations: Annotation[];
  onSelectControl: (id: string) => void;
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
  const allAnnotations = annotations.filter((a) =>
    ["comment", "highlight", "ink", "freetext"].includes(a.type),
  );

  // Filter based on type and search term
  const filteredAnnotations = allAnnotations.filter((annot) => {
    // Type filter
    if (!selectedTypes.includes(annot.type)) return false;

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

  // Group by page
  const groupedAnnotations = filteredAnnotations.reduce(
    (acc, annot) => {
      const page = annot.pageIndex + 1;
      if (!acc[page]) acc[page] = [];
      acc[page].push(annot);
      return acc;
    },
    {} as Record<number, Annotation[]>,
  );

  const sortedPages = Object.keys(groupedAnnotations)
    .map(Number)
    .sort((a, b) => a - b);

  const handleSelect = (id: string) => {
    onSelectControl(id);
    // Scroll the main workspace to the annotation
    // We use a small timeout to ensure the DOM is ready if needed,
    // though usually the element should already exist.
    setTimeout(() => {
      const element = document.getElementById(`annotation-${id}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 10);
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
                      onSelect={() => handleSelect(annot.id)}
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
