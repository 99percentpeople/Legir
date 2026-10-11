import { useId, type ReactNode } from "react";
import { RectangleHorizontal, RectangleVertical } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { BlankPageSize } from "./types";

export function BlankPageOptions({
  size,
  landscape,
  count,
  width,
  height,
  hasSelection,
  onSizeChange,
  onLandscapeChange,
  onCountChange,
  children,
}: {
  size: BlankPageSize;
  landscape: boolean;
  count: number;
  width: number;
  height: number;
  hasSelection: boolean;
  onSizeChange: (size: BlankPageSize) => void;
  onLandscapeChange: (landscape: boolean) => void;
  onCountChange: (count: number) => void;
  children: ReactNode;
}) {
  const { t, effectiveLanguage } = useLanguage();
  const id = useId();
  const validCount = Number.isInteger(count) && count >= 1 && count <= 1000;
  const previewScale = Math.min(140 / width, 168 / height);
  const format = new Intl.NumberFormat(effectiveLanguage, {
    maximumFractionDigits: 1,
  });
  return (
    <div className="grid min-w-0 gap-5 sm:grid-cols-[minmax(0,1fr)_12rem]">
      <div className="grid min-w-0 content-start gap-5">
        <div className="grid min-w-0 gap-4">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-size`}>{t("page_editor.size")}</Label>
            <Select
              value={size}
              onValueChange={(value) => onSizeChange(value as BlankPageSize)}
            >
              <SelectTrigger id={`${id}-size`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="same">
                  {t(
                    hasSelection
                      ? "page_editor.same_size"
                      : "page_editor.current_size",
                  )}
                </SelectItem>
                <SelectItem value="a4">A4</SelectItem>
                <SelectItem value="a3">A3</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label id={`${id}-orientation`}>
              {t("page_editor.orientation")}
            </Label>
            <ToggleGroup
              type="single"
              variant="outline"
              size="lg"
              value={landscape ? "landscape" : "portrait"}
              onValueChange={(value) => {
                if (value) onLandscapeChange(value === "landscape");
              }}
              aria-labelledby={`${id}-orientation`}
              className="w-full"
            >
              <ToggleGroupItem value="portrait" className="flex-1 gap-2">
                <RectangleVertical aria-hidden="true" />
                {t("page_editor.portrait")}
              </ToggleGroupItem>
              <ToggleGroupItem value="landscape" className="flex-1 gap-2">
                <RectangleHorizontal aria-hidden="true" />
                {t("page_editor.landscape")}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <NumberInput
            label={t("page_editor.count")}
            value={count}
            minValue={1}
            maxValue={1000}
            step={1}
            formatOptions={{ useGrouping: false, maximumFractionDigits: 0 }}
            onChange={onCountChange}
            isInvalid={!validCount}
          />
        </div>
        <div className="border-t pt-4">{children}</div>
      </div>
      <div
        className="bg-muted/30 min-w-0 self-start rounded-lg border"
        data-blank-preview
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5 text-xs">
          <span>{t("page_editor.preview")}</span>
          <span className="text-muted-foreground" aria-live="polite">
            {validCount ? t("page_editor.total", { count }) : "—"}
          </span>
        </div>
        <div className="flex h-48 items-center justify-center p-3">
          <div
            className="border bg-white shadow-sm"
            data-blank-paper
            style={{
              width: width * previewScale,
              height: height * previewScale,
            }}
          />
        </div>
        <p
          className="text-muted-foreground border-t px-3 py-2.5 text-center text-xs tabular-nums"
          aria-live="polite"
        >
          {format.format((width * 25.4) / 72)} ×{" "}
          {format.format((height * 25.4) / 72)} mm
        </p>
      </div>
    </div>
  );
}
