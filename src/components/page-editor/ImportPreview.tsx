import { useId, useMemo, useRef, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPageRange, parsePageRange } from "@/utils/pageRange";
import { cn } from "@/utils/cn";
import { ImportPreviewGrid } from "./ImportPreviewGrid";
import type { ImportedDocument } from "./types";

export function ImportPreview({
  imported,
  range,
  onRangeChange,
  children,
}: {
  imported: ImportedDocument;
  range: string;
  onRangeChange: (value: string) => void;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const id = useId();
  const anchor = useRef<number | null>(null);
  const total = imported.document.pages.length;
  const parsed = useMemo(
    () => parsePageRange(range, total, { empty: "none" }),
    [range, total],
  );
  const selected = new Set(parsed.ok ? parsed.pageIndices : []);
  const toggle = (index: number, shiftKey: boolean) => {
    if (shiftKey && anchor.current !== null) {
      for (
        let n = Math.min(anchor.current, index);
        n <= Math.max(anchor.current, index);
        n++
      )
        selected.add(n);
    } else {
      if (selected.has(index)) selected.delete(index);
      else selected.add(index);
      anchor.current = index;
    }
    onRangeChange(formatPageRange(selected));
  };
  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
          <FileText size={20} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={imported.filename}>
            {imported.filename}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t("page_editor.total", { count: total })}
          </p>
        </div>
      </div>
      <div className="grid min-w-0 gap-5 sm:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-5">
          <div className="grid gap-2">
            <Label htmlFor={id}>{t("page_editor.range")}</Label>
            <Input
              id={id}
              value={range}
              placeholder={t("properties.form_detection.page_range_hint")}
              aria-invalid={!parsed.ok}
              aria-describedby={`${id}-hint`}
              onChange={(event) => onRangeChange(event.target.value)}
            />
            <p
              id={`${id}-hint`}
              className={cn(
                "text-xs leading-relaxed",
                parsed.ok ? "text-muted-foreground" : "text-destructive",
              )}
            >
              {parsed.ok ? t("page_editor.range_hint") : t(parsed.errorKey)}
            </p>
          </div>
          {children}
        </div>
        <div className="bg-muted/30 min-w-0 self-start rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5 text-xs">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={
                  selected.size === total
                    ? true
                    : selected.size
                      ? "indeterminate"
                      : false
                }
                onCheckedChange={(checked) => {
                  anchor.current = null;
                  onRangeChange(
                    checked
                      ? formatPageRange(
                          Array.from({ length: total }, (_, i) => i),
                        )
                      : "",
                  );
                }}
              />
              {t("page_editor.select_all")}
            </label>
            <span className="text-muted-foreground" aria-live="polite">
              {t("page_editor.selected", { count: selected.size, total })}
            </span>
          </div>
          <ImportPreviewGrid
            imported={imported}
            selected={selected}
            onToggle={toggle}
          />
        </div>
      </div>
    </div>
  );
}
