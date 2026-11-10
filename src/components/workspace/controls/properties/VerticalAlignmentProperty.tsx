import {
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
} from "lucide-react";
import type { FormField } from "@/types";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/components/language-provider";
import { cn } from "@/utils/cn";

export function VerticalAlignmentProperty({
  value,
  onChange,
}: {
  value: NonNullable<FormField["verticalAlignment"]>;
  onChange: (value: NonNullable<FormField["verticalAlignment"]>) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-2">
      <Label>{t("properties.vertical_alignment")}</Label>
      <div
        role="group"
        aria-label={t("properties.vertical_alignment")}
        className="bg-muted border-input flex rounded-md border p-1"
      >
        {(
          [
            ["top", AlignVerticalJustifyStart],
            ["middle", AlignVerticalJustifyCenter],
            ["bottom", AlignVerticalJustifyEnd],
          ] as const
        ).map(([alignment, Icon]) => (
          <button
            key={alignment}
            type="button"
            aria-pressed={value === alignment}
            aria-label={t(`properties.vertical_alignment_options.${alignment}`)}
            title={t(`properties.vertical_alignment_options.${alignment}`)}
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
