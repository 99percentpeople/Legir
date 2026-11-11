import { AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import type { HorizontalAlignment } from "@legir/pdf-model";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/components/language-provider";
import { cn } from "@/utils/cn";

export function HorizontalAlignmentProperty({
  value,
  onChange,
}: {
  value: HorizontalAlignment | undefined;
  onChange: (value: HorizontalAlignment) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-2">
      <Label>{t("properties.alignment")}</Label>
      {value === undefined && (
        <span className="text-muted-foreground block text-xs">
          {t("properties.mixed_values")}
        </span>
      )}
      <div
        role="group"
        aria-label={t("properties.alignment")}
        className="bg-muted border-input flex rounded-md border p-1"
      >
        {(
          [
            ["left", AlignLeft],
            ["center", AlignCenter],
            ["right", AlignRight],
          ] as const
        ).map(([alignment, Icon]) => (
          <button
            key={alignment}
            type="button"
            aria-pressed={value === alignment}
            aria-label={t(`properties.alignment_options.${alignment}`)}
            title={t(`properties.alignment_options.${alignment}`)}
            onClick={() => {
              if (value !== alignment) onChange(alignment);
            }}
            className={cn(
              "text-foreground/50 hover:bg-background hover:text-foreground flex flex-1 justify-center rounded p-1 transition-colors",
              value === alignment && "bg-background text-foreground shadow-sm",
            )}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>
    </div>
  );
}
