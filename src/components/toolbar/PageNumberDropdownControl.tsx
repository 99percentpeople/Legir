import React from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/utils/cn";
import { useLanguage } from "../language-provider";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

type PageNumberDropdownControlProps = {
  currentPageIndex: number;
  pageCount: number;
  disabled?: boolean;
  compact?: boolean;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onNavigatePage: (pageIndex: number) => void;
};

const ELLIPSIS = -1;

const buildPageItems = (currentPageIndex: number, pageCount: number) => {
  if (pageCount <= 0) return [];

  const current = Math.max(0, Math.min(currentPageIndex, pageCount - 1));
  const windowStart = Math.max(0, current - 2);
  const windowEnd = Math.min(pageCount - 1, current + 2);
  const items: number[] = [];

  if (windowStart > 0) {
    items.push(0);
    if (windowStart > 1) items.push(ELLIPSIS);
  }

  for (let pageIndex = windowStart; pageIndex <= windowEnd; pageIndex += 1) {
    items.push(pageIndex);
  }

  if (windowEnd < pageCount - 1) {
    if (windowEnd < pageCount - 2) items.push(ELLIPSIS);
    items.push(pageCount - 1);
  }

  return items;
};

const PageNumberDropdownControl: React.FC<PageNumberDropdownControlProps> = ({
  currentPageIndex,
  pageCount,
  disabled = false,
  compact = true,
  side = "top",
  align = "center",
  className,
  open,
  onOpenChange,
  onNavigatePage,
}) => {
  const { t } = useLanguage();
  const safePageCount = Math.max(0, pageCount);
  const safeCurrentPageIndex =
    safePageCount > 0
      ? Math.max(0, Math.min(currentPageIndex, safePageCount - 1))
      : 0;
  const canGoPrevious = safeCurrentPageIndex > 0;
  const canGoNext = safeCurrentPageIndex < safePageCount - 1;
  const pageItems = buildPageItems(safeCurrentPageIndex, safePageCount);
  const pageDigitCount = String(Math.max(1, safePageCount)).length;
  const pageLabelWidthCh = Math.max(3, pageDigitCount * 2 + 1);
  const pageLabel =
    safePageCount > 0 ? `${safeCurrentPageIndex + 1}/${safePageCount}` : "0/0";

  if (!compact) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled || !canGoPrevious}
          onClick={() => onNavigatePage(safeCurrentPageIndex - 1)}
          title={t("toolbar.previous_page")}
          className="h-8 w-8"
        >
          <ChevronLeft size={16} />
        </Button>
        <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled || safePageCount === 0}
              className="h-8 px-2 text-sm font-medium"
              title={t("toolbar.page")}
            >
              <span
                className="inline-block text-center tabular-nums"
                style={{ width: `${pageLabelWidthCh}ch` }}
              >
                {pageLabel}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={side}
            align={align}
            className="min-w-44"
            data-app-block-modifier-wheel-zoom="1"
          >
            <DropdownMenuLabel>{t("toolbar.page")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={String(safeCurrentPageIndex)}
              onValueChange={(value) => onNavigatePage(Number(value))}
            >
              {pageItems.map((pageIndex, itemIndex) =>
                pageIndex === ELLIPSIS ? (
                  <DropdownMenuLabel
                    key={`ellipsis-${itemIndex}`}
                    className="px-2 py-1 text-center"
                  >
                    ...
                  </DropdownMenuLabel>
                ) : (
                  <DropdownMenuRadioItem
                    key={pageIndex}
                    value={String(pageIndex)}
                  >
                    {t("toolbar.page")} {pageIndex + 1}
                  </DropdownMenuRadioItem>
                ),
              )}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled || !canGoNext}
          onClick={() => onNavigatePage(safeCurrentPageIndex + 1)}
          title={t("toolbar.next_page")}
          className="h-8 w-8"
        >
          <ChevronRight size={16} />
        </Button>
      </div>
    );
  }

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || safePageCount === 0}
          className={cn("h-8 gap-1 px-2 text-sm font-medium", className)}
          title={t("toolbar.page")}
        >
          <span
            className="inline-block text-center tabular-nums"
            style={{ width: `${pageLabelWidthCh}ch` }}
          >
            {pageLabel}
          </span>
          <ChevronDown size={12} className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={side}
        align={align}
        className="min-w-44"
        data-app-block-modifier-wheel-zoom="1"
      >
        <DropdownMenuLabel>{t("toolbar.page")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!canGoPrevious}
          onClick={() => onNavigatePage(safeCurrentPageIndex - 1)}
        >
          <ChevronLeft size={14} />
          {t("toolbar.previous_page")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canGoNext}
          onClick={() => onNavigatePage(safeCurrentPageIndex + 1)}
        >
          <ChevronRight size={14} />
          {t("toolbar.next_page")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={String(safeCurrentPageIndex)}
          onValueChange={(value) => onNavigatePage(Number(value))}
        >
          {pageItems.map((pageIndex, itemIndex) =>
            pageIndex === ELLIPSIS ? (
              <DropdownMenuLabel
                key={`ellipsis-${itemIndex}`}
                className="px-2 py-1 text-center"
              >
                ...
              </DropdownMenuLabel>
            ) : (
              <DropdownMenuRadioItem key={pageIndex} value={String(pageIndex)}>
                {t("toolbar.page")} {pageIndex + 1}
              </DropdownMenuRadioItem>
            ),
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default PageNumberDropdownControl;
