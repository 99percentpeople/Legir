import React from "react";
import { toast } from "sonner";
import type { RecentFileEntry } from "@/services/recentFiles";
import type { HomePageAdapter, HomePageTranslation } from "../types";

interface UseHomeRecentFilesOptions {
  adapter: HomePageAdapter;
  t: HomePageTranslation;
}

export function useHomeRecentFiles({ adapter, t }: UseHomeRecentFilesOptions) {
  const [recentFiles, setRecentFiles] = React.useState<RecentFileEntry[]>([]);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    const applyEntries = (entries: RecentFileEntry[]) => {
      if (cancelled) return;
      setRecentFiles(entries);
    };

    void adapter.store.list().then(applyEntries);
    const unsubscribe = adapter.store.subscribe(applyEntries);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [adapter]);

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

  const handleDeleteRecent = React.useCallback(
    async (path: string) => {
      const next = await adapter.store.remove(path);
      setRecentFiles(next);
    },
    [adapter],
  );

  const handleClearAll = React.useCallback(async () => {
    const ok = await adapter.confirmClearAll(
      t("home.desktop.confirm_clear_all"),
    );
    if (!ok) return;

    const next = await adapter.store.clear();
    setRecentFiles(next);
  }, [adapter, t]);

  const handleOpen = React.useCallback(async () => {
    await adapter.open();
  }, [adapter]);

  const handleOpenRecent = React.useCallback(
    async (entry: RecentFileEntry) => {
      try {
        await adapter.openRecent(entry);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        toast.error(message || t("home.desktop.open_fail"));
      }
    },
    [adapter, t],
  );

  return {
    recentFiles,
    query,
    setQuery,
    filteredRecentFiles,
    handleOpen,
    handleDeleteRecent,
    handleClearAll,
    handleOpenRecent,
  };
}
