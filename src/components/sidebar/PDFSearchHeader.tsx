import React, { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { useLanguage } from "../language-provider";
import { Button } from "../ui/button";
import { cn } from "@/utils/cn";

interface PDFSearchHeaderProps {
  query: string;
  focusToken: number;
  caseSensitive: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onQueryChange: (value: string) => void;
  onToggleCaseSensitive: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

const PDFSearchHeader: React.FC<PDFSearchHeaderProps> = ({
  query,
  focusToken,
  caseSensitive,
  canGoPrevious,
  canGoNext,
  onQueryChange,
  onToggleCaseSensitive,
  onPrevious,
  onNext,
}) => {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.focus();
    inputRef.current.select();
  }, [focusToken]);

  return (
    <div className="flex min-w-0 flex-1 items-center">
      <div className="border-border bg-background focus-within:border-ring/60 focus-within:ring-ring/20 flex h-9 min-w-0 flex-1 items-center rounded-md border pr-1 shadow-sm transition-[border-color,box-shadow] focus-within:ring-4">
        <Search className="text-muted-foreground ml-2 h-3.5 w-3.5 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (e.shiftKey) onPrevious();
            else onNext();
          }}
          placeholder={t("sidebar.search_pdf_placeholder")}
          className="placeholder:text-muted-foreground h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-xs outline-none"
        />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onToggleCaseSensitive}
          className={cn(
            "size-7 shrink-0 rounded-sm px-2 font-mono text-[11px]",
            caseSensitive && "bg-accent text-accent-foreground",
          )}
          title={t("sidebar.search_case_sensitive")}
        >
          Aa
        </Button>

        <div className="bg-border mx-1 h-4 w-px shrink-0" />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onPrevious}
          disabled={!canGoPrevious}
          className="h-7 w-7 shrink-0 rounded-sm"
          title={t("sidebar.search_previous")}
        >
          <ChevronUp size={15} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onNext}
          disabled={!canGoNext}
          className="h-7 w-7 shrink-0 rounded-sm"
          title={t("sidebar.search_next")}
        >
          <ChevronDown size={15} />
        </Button>
      </div>
    </div>
  );
};

export default PDFSearchHeader;
