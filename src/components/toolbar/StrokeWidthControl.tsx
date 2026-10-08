import { cn } from "@/utils/cn";
import { useLanguage } from "../language-provider";
import { Button } from "../ui/button";
import { NumberInput } from "../ui/number-input";
import { StrokePreview } from "./StrokePreview";
import type { StrokeWidthControlProps } from "./types";

export function StrokeWidthControl({
  min = 1,
  onChange,
  ...stroke
}: StrokeWidthControlProps) {
  const { t } = useLanguage();
  const presets =
    min === 0
      ? [0, 1, 2, 3, 5, 8]
      : stroke.variant === "highlight"
        ? [2, 4, 8, 12, 16, 20]
        : [1, 2, 3, 5, 8, 12];
  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-label={t("properties.thickness")}
        className="grid grid-cols-3 gap-1"
      >
        {presets.map((value) => (
          <Button
            key={value}
            variant="ghost"
            type="button"
            aria-label={`${t("properties.thickness")} ${value} px`}
            aria-pressed={stroke.thickness === value}
            className={cn(
              "h-auto flex-col gap-0 px-1 py-1 text-xs",
              stroke.thickness === value && "bg-accent text-accent-foreground",
            )}
            onClick={() => {
              if (stroke.thickness !== value) onChange(value);
            }}
          >
            <StrokePreview {...stroke} thickness={value} compact />
            <span className="tabular-nums">{value} px</span>
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-sm">{t("properties.thickness")}</span>
        <NumberInput
          className="min-w-0 flex-1"
          aria-label={t("properties.thickness")}
          value={stroke.thickness}
          minValue={min}
          maxValue={20}
          step={0.5}
          formatOptions={{ maximumFractionDigits: 1 }}
          onChange={(value) => {
            if (Number.isFinite(value))
              onChange(Math.min(20, Math.max(min, value)));
          }}
        />
        <span className="text-muted-foreground text-sm">px</span>
      </div>
    </div>
  );
}
