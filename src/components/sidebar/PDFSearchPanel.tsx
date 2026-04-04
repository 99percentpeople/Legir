import React, { useEffect, useMemo, useRef } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { PDFSearchMode } from "@/lib/pdfSearch";
import type { PDFSearchResult } from "@/types";
import { useLanguage } from "../language-provider";
import { cn } from "@/utils/cn";

interface PDFSearchPanelProps {
  query: string;
  mode: PDFSearchMode;
  caseSensitive: boolean;
  results: PDFSearchResult[];
  activeResultId: string | null;
  activeResultIndex: number;
  isSearching: boolean;
  errorMessage: string | null;
  onToggleCaseSensitive: () => void;
  onToggleRegex: () => void;
  onSelectResult: (result: PDFSearchResult) => void;
}

const PDFSearchPanel: React.FC<PDFSearchPanelProps> = ({
  query,
  mode,
  caseSensitive,
  results,
  activeResultId,
  activeResultIndex,
  isSearching,
  errorMessage,
  onToggleCaseSensitive,
  onToggleRegex,
  onSelectResult,
}) => {
  const { t } = useLanguage();
  const listRef = useRef<HTMLDivElement>(null);
  const lastResultsKeyRef = useRef("");
  const hasScrolledForCurrentResultsRef = useRef(false);
  const toolbarValue = useMemo(
    () => [
      ...(caseSensitive ? ["case"] : []),
      ...(mode === "regex" ? ["regex"] : []),
    ],
    [caseSensitive, mode],
  );

  const groupedResults = useMemo(() => {
    const groups = new Map<number, PDFSearchResult[]>();
    for (const result of results) {
      const group = groups.get(result.pageIndex);
      if (group) group.push(result);
      else groups.set(result.pageIndex, [result]);
    }
    return Array.from(groups.entries()).map(([pageIndex, matches]) => ({
      pageIndex,
      matches,
    }));
  }, [results]);

  const resultsKey = useMemo(() => {
    const firstId = results[0]?.id ?? "";
    const lastId = results[results.length - 1]?.id ?? "";
    return `${query}::${results.length}::${firstId}::${lastId}`;
  }, [query, results]);

  useEffect(() => {
    if (lastResultsKeyRef.current === resultsKey) return;
    lastResultsKeyRef.current = resultsKey;
    hasScrolledForCurrentResultsRef.current = false;
  }, [resultsKey]);

  useEffect(() => {
    if (!activeResultId || !listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>(
      `[data-search-result-id="${activeResultId}"]`,
    );
    activeEl?.scrollIntoView(
      hasScrolledForCurrentResultsRef.current
        ? {
            behavior: "smooth",
            block: "nearest",
          }
        : {
            behavior: "instant",
            block: "center",
          },
    );
    hasScrolledForCurrentResultsRef.current = true;
  }, [activeResultId]);

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <div className="border-border bg-muted/30 flex shrink-0 flex-wrap-reverse justify-between gap-2 border-b px-3 py-2">
        <div className="text-muted-foreground flex flex-1 items-center justify-between gap-2 text-[11px] text-nowrap">
          <span>
            {t("sidebar.search_results_summary", {
              total: results.length,
              pages: groupedResults.length,
            })}
          </span>
          {activeResultIndex >= 0 && (
            <span>
              {t("sidebar.search_current_result", {
                current: activeResultIndex + 1,
                total: results.length,
              })}
            </span>
          )}
        </div>

        <ToggleGroup
          type="multiple"
          variant="default"
          size="sm"
          spacing={1}
          value={toolbarValue}
          onValueChange={(nextValue) => {
            const nextCaseSensitive = nextValue.includes("case");
            const nextRegex = nextValue.includes("regex");
            if (nextCaseSensitive !== caseSensitive) onToggleCaseSensitive();
            if (nextRegex !== (mode === "regex")) onToggleRegex();
          }}
          className="ml-auto"
          aria-label={t("sidebar.search_results_summary", {
            total: results.length,
            pages: groupedResults.length,
          })}
        >
          <ToggleGroupItem
            value="case"
            className="data-[state=on]:bg-accent data-[state=on]:text-accent-foreground h-7 rounded-sm px-2 font-mono text-[11px]"
            title={t("sidebar.search_case_sensitive")}
            aria-label={t("sidebar.search_case_sensitive")}
          >
            Aa
          </ToggleGroupItem>
          <ToggleGroupItem
            value="regex"
            className="data-[state=on]:bg-accent data-[state=on]:text-accent-foreground h-7 rounded-sm px-2 font-mono text-[11px]"
            title={t("sidebar.search_regex")}
            aria-label={t("sidebar.search_regex")}
          >
            .*
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto p-2">
        {!query.trim() ? (
          <div className="text-muted-foreground py-8 text-center text-sm">
            {t("sidebar.search_pdf_empty")}
          </div>
        ) : errorMessage ? (
          <div className="text-destructive py-8 text-center text-sm">
            {errorMessage}
          </div>
        ) : isSearching ? (
          <div className="text-muted-foreground py-8 text-center text-sm">
            {t("sidebar.searching")}
          </div>
        ) : groupedResults.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center text-sm">
            {t("sidebar.no_results")}
          </div>
        ) : (
          groupedResults.map((group) => (
            <section key={group.pageIndex} className="mb-4 last:mb-0">
              <div className="text-muted-foreground mb-2 flex items-center justify-between px-2 text-[11px] font-medium tracking-wide uppercase">
                <span>{t("sidebar.page", { page: group.pageIndex + 1 })}</span>
                <span>
                  {t("sidebar.search_matches_count", {
                    total: group.matches.length,
                  })}
                </span>
              </div>
              <div className="space-y-1">
                {group.matches.map((result) => {
                  const isActive = result.id === activeResultId;
                  return (
                    <button
                      key={result.id}
                      type="button"
                      data-search-result-id={result.id}
                      onClick={() => onSelectResult(result)}
                      className={cn(
                        "border-border bg-background hover:bg-accent/50 block w-full rounded-md border px-3 py-2 text-left transition-colors",
                        isActive &&
                          "bg-accent/40 ring-primary/30 ring-1 ring-inset",
                      )}
                    >
                      <div className="text-foreground text-sm leading-6 wrap-break-word">
                        {result.displaySegments.map((segment, index) => (
                          <span
                            key={`${result.id}:${index}`}
                            className={cn(
                              segment.highlighted &&
                                "app-pdf-search-hit--inline",
                              segment.highlighted &&
                                isActive &&
                                "app-pdf-search-hit--active",
                            )}
                          >
                            {segment.text}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
};

export default PDFSearchPanel;
