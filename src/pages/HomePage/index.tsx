import React from "react";
import { useLanguage } from "@/components/language-provider";
import { RecentFilesHomeView } from "./RecentFilesHomeView";
import { useHomeRecentFiles } from "./hooks/useHomeRecentFiles";
import type { HomePageProps, HomeRecentFilesViewMode } from "./types";

export type { HomePageAdapter, HomePageProps } from "./types";

const RECENT_FILES_VIEW_MODE_STORAGE_KEY = "legir.home.recentFilesViewMode";

const isRecentFilesViewMode = (
  value: string | null,
): value is HomeRecentFilesViewMode => value === "list" || value === "grid";

const getInitialRecentFilesViewMode = (): HomeRecentFilesViewMode => {
  if (typeof window === "undefined") return "list";

  try {
    const storedValue = window.localStorage.getItem(
      RECENT_FILES_VIEW_MODE_STORAGE_KEY,
    );
    return isRecentFilesViewMode(storedValue) ? storedValue : "list";
  } catch {
    return "list";
  }
};

const HomePage: React.FC<HomePageProps> = ({ adapter }) => {
  const { t } = useLanguage();
  const [recentFilesViewMode, setRecentFilesViewMode] =
    React.useState<HomeRecentFilesViewMode>(getInitialRecentFilesViewMode);
  const {
    recentFiles,
    query,
    setQuery,
    filteredRecentFiles,
    handleOpen,
    handleDeleteRecent,
    handleClearAll,
    handleOpenRecent,
  } = useHomeRecentFiles({
    adapter,
    t,
  });

  const handleRecentFilesViewModeChange = React.useCallback(
    (viewMode: HomeRecentFilesViewMode) => {
      setRecentFilesViewMode(viewMode);

      try {
        window.localStorage.setItem(
          RECENT_FILES_VIEW_MODE_STORAGE_KEY,
          viewMode,
        );
      } catch {
        // Ignore unavailable storage; the in-memory selection still works.
      }
    },
    [],
  );

  return (
    <RecentFilesHomeView
      query={query}
      filteredRecentFiles={filteredRecentFiles}
      viewMode={recentFilesViewMode}
      canClearAll={recentFiles.length > 0}
      onQueryChange={setQuery}
      onClearQuery={() => setQuery("")}
      onOpen={handleOpen}
      onOpenRecent={handleOpenRecent}
      onDeleteRecent={handleDeleteRecent}
      onClearAll={handleClearAll}
      onViewModeChange={handleRecentFilesViewModeChange}
    />
  );
};

export default HomePage;
