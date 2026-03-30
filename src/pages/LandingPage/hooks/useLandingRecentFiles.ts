import React from "react";
import { toast } from "sonner";
import { confirmPlatformAction, usePlatformUi } from "@/services/platform";
import {
  recentFilesService,
  type RecentFileEntry,
} from "@/services/recentFilesService";
import type { LandingTranslation } from "../types";

interface UseLandingRecentFilesOptions {
  onOpenRecent?: (filePath: string) => Promise<void>;
  t: LandingTranslation;
}

export function useLandingRecentFiles({
  onOpenRecent,
  t,
}: UseLandingRecentFilesOptions) {
  const { supportsRecentFiles } = usePlatformUi();
  const [recentFiles, setRecentFiles] = React.useState<RecentFileEntry[]>([]);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (!supportsRecentFiles) return;
    setRecentFiles(recentFilesService.getAll());
  }, [supportsRecentFiles]);

  const filteredRecentFiles = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return recentFiles;
    return recentFiles.filter((entry) => {
      return (
        entry.filename.toLowerCase().includes(normalizedQuery) ||
        entry.path.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [query, recentFiles]);

  const handleDeleteRecent = React.useCallback((path: string) => {
    const next = recentFilesService.remove(path);
    setRecentFiles(next);
  }, []);

  const handleClearAll = React.useCallback(async () => {
    const ok = await confirmPlatformAction(
      t("landing.desktop.confirm_clear_all"),
    );
    if (!ok) return;
    const next = recentFilesService.clear();
    setRecentFiles(next);
  }, [t]);

  const handleOpenRecent = React.useCallback(
    async (entry: RecentFileEntry) => {
      if (!onOpenRecent) return;
      try {
        await onOpenRecent(entry.path);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        toast.error(message || t("landing.desktop.open_fail"));
      }
    },
    [onOpenRecent, t],
  );

  return {
    supportsRecentFiles,
    recentFiles,
    query,
    setQuery,
    filteredRecentFiles,
    handleDeleteRecent,
    handleClearAll,
    handleOpenRecent,
  };
}
