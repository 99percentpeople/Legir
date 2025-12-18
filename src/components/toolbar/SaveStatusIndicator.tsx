import React, { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "../../lib/utils";
import { useLanguage } from "../language-provider";
import dayjs from "dayjs";

interface SaveStatusIndicatorProps {
  isSaving: boolean;
  isDirty?: boolean;
  lastSavedAt: Date | null;
  className?: string;
}

export const SaveStatusIndicator: React.FC<SaveStatusIndicatorProps> = ({
  isSaving,
  isDirty = false,
  lastSavedAt,
  className,
}) => {
  const { t, dayjsLocale } = useLanguage();
  const [timeAgo, setTimeAgo] = useState<string>("");

  useEffect(() => {
    if (!lastSavedAt) return;

    const updateTimeAgo = () => {
      setTimeAgo(dayjs(lastSavedAt).locale(dayjsLocale).fromNow());
    };

    updateTimeAgo();
    const interval = setInterval(updateTimeAgo, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [lastSavedAt, dayjsLocale]); // Re-run when locale changes

  if (isSaving) {
    return (
      <div
        className={cn(
          "text-muted-foreground/60 flex items-center gap-1.5 text-[10px] transition-opacity duration-500",
          className,
        )}
      >
        <Loader2 size={10} className="animate-spin" />
        <span className="hidden md:inline">{t("status.saving")}</span>
      </div>
    );
  }

  if (isDirty) {
    return (
      <div
        className={cn(
          "text-muted-foreground/80 flex items-center gap-1.5 text-[10px] transition-opacity duration-500",
          className,
        )}
      >
        <div className="h-1.5 w-1.5 rounded-full bg-amber-500/70" />
        <span className="hidden md:inline">{t("status.unsaved")}</span>
      </div>
    );
  }

  if (lastSavedAt) {
    return (
      <div
        className={cn(
          "text-muted-foreground/40 flex items-center gap-1.5 text-[10px] transition-opacity duration-500",
          className,
        )}
      >
        <CheckCircle2 size={10} />
        <span className="hidden md:inline">
          {t("status.saved")} {timeAgo}
        </span>
      </div>
    );
  }

  return null;
};
