import { CheckCircle2, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";

import { useLanguage } from "@/components/language-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getEffectivePdfPermissions } from "@/lib/pdfPermissions";
import { cn } from "@/utils/cn";
import type { PDFDocumentPermissions } from "@/types";

interface DocumentPermissionsPopoverProps {
  documentPermissions?: PDFDocumentPermissions | null;
  sourceDocumentPermissions?: PDFDocumentPermissions | null;
  pdfOwnerUnlocked?: boolean;
}

export function DocumentPermissionsPopover({
  documentPermissions,
  sourceDocumentPermissions,
  pdfOwnerUnlocked = false,
}: DocumentPermissionsPopoverProps) {
  const { t } = useLanguage();
  const permissions = getEffectivePdfPermissions(documentPermissions);
  const sourcePermissions = getEffectivePdfPermissions(
    sourceDocumentPermissions ?? documentPermissions,
  );

  if (pdfOwnerUnlocked || !sourcePermissions.hasOwnerRestrictions) return null;

  const items = [
    ["open", permissions.canOpen],
    ["modify_contents", permissions.canModifyContents],
    ["modify_annotations", permissions.canModifyAnnotations],
    ["fill_forms", permissions.canFillForms],
    ["copy", permissions.canCopy],
    ["copy_accessibility", permissions.canCopyForAccessibility],
    ["print", permissions.canPrint],
    ["print_high_quality", permissions.canPrintHighQuality],
    ["assemble", permissions.canAssemble],
  ] as const;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs text-amber-700 hover:bg-amber-50 hover:text-amber-800 sm:h-9 sm:px-3 dark:text-amber-300 dark:hover:bg-amber-950/30"
          title={t("properties.permissions.restricted_trigger")}
        >
          <ShieldAlert size={15} />
          <span>{t("properties.permissions.restricted_trigger")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <ShieldCheck size={16} className="text-muted-foreground shrink-0" />
            <span className="truncate text-sm font-medium">
              {t("properties.permissions.title")}
            </span>
          </div>
          <Badge variant="outline" className="shrink-0">
            {t("properties.permissions.restricted")}
          </Badge>
        </div>

        <p className="text-muted-foreground text-xs">
          {t("properties.permissions.restricted_desc")}
        </p>

        <div className="grid grid-cols-1 gap-2">
          {items.map(([key, allowed]) => (
            <div
              key={key}
              className="flex items-center gap-2 px-2 py-1.5 text-xs"
            >
              <span
                className={cn(
                  "flex items-center gap-1 font-medium",
                  allowed ? "text-emerald-600" : "text-destructive",
                )}
              >
                {allowed ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                {allowed
                  ? t("properties.permissions.allowed")
                  : t("properties.permissions.denied")}
              </span>
              <span>{t(`properties.permissions.${key}`)}</span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
