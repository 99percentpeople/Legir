import { useId } from "react";
import { useLanguage } from "@/components/language-provider";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { cn } from "@/utils/cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { InsertPosition } from "./types";

export function insertionIndex(
  position: InsertPosition,
  target: number,
  total: number,
  selected: number[],
): number | null {
  if (position === "start") return 0;
  if (position === "end") return total;
  if (position === "before" || position === "after")
    return selected.length
      ? position === "before"
        ? Math.min(...selected)
        : Math.max(...selected) + 1
      : null;
  if (!Number.isInteger(target) || target < 1 || target > total) return null;
  return target - 1 + (position === "after_page" ? 1 : 0);
}

export function InsertionPosition({
  position,
  targetPage,
  total,
  hasSelection,
  stacked = false,
  onPositionChange,
  onTargetPageChange,
}: {
  position: InsertPosition;
  targetPage: number;
  total: number;
  hasSelection: boolean;
  stacked?: boolean;
  onPositionChange: (position: InsertPosition) => void;
  onTargetPageChange: (page: number) => void;
}) {
  const { t } = useLanguage();
  const id = useId();
  return (
    <div className={cn("min-w-0 gap-3", stacked ? "grid" : "flex items-end")}>
      <div className="grid min-w-0 flex-1 gap-2">
        <Label htmlFor={id}>{t("page_editor.position")}</Label>
        <Select
          value={position}
          onValueChange={(value) => onPositionChange(value as InsertPosition)}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="start">{t("page_editor.start")}</SelectItem>
            <SelectItem value="end">{t("page_editor.end")}</SelectItem>
            <SelectItem value="before_page">
              {t("page_editor.before_page")}
            </SelectItem>
            <SelectItem value="after_page">
              {t("page_editor.after_page")}
            </SelectItem>
            {hasSelection && (
              <>
                <SelectItem value="before">
                  {t("page_editor.before")}
                </SelectItem>
                <SelectItem value="after">{t("page_editor.after")}</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
      </div>
      {(position === "before_page" || position === "after_page") && (
        <div className={cn("grid min-w-0 gap-2", !stacked && "w-28 shrink-0")}>
          <NumberInput
            className="min-w-0"
            label={t("page_editor.target")}
            minValue={1}
            maxValue={total}
            step={1}
            formatOptions={{ useGrouping: false, maximumFractionDigits: 0 }}
            value={targetPage}
            onChange={onTargetPageChange}
            isInvalid={
              !Number.isInteger(targetPage) ||
              targetPage < 1 ||
              targetPage > total
            }
          />
        </div>
      )}
    </div>
  );
}
