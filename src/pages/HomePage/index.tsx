import React from "react";
import { useLanguage } from "@/components/language-provider";
import { RecentFilesHomeView } from "./RecentFilesHomeView";
import { useHomeRecentFiles } from "./hooks/useHomeRecentFiles";
import type { HomePageProps } from "./types";

export type { HomePageAdapter, HomePageProps } from "./types";

const HomePage: React.FC<HomePageProps> = ({ adapter }) => {
  const { t } = useLanguage();
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

  return (
    <RecentFilesHomeView
      query={query}
      recentFiles={recentFiles}
      filteredRecentFiles={filteredRecentFiles}
      onQueryChange={setQuery}
      onClearQuery={() => setQuery("")}
      onOpen={handleOpen}
      onOpenRecent={handleOpenRecent}
      onDeleteRecent={handleDeleteRecent}
      onClearAll={handleClearAll}
      t={t}
    />
  );
};

export default HomePage;
