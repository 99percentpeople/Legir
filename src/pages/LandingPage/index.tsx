import { PlatformSwitch } from "@/services/platform";
import { useLanguage } from "@/components/language-provider";
import { DesktopLandingView } from "./DesktopLandingView";
import { WebLandingView } from "./WebLandingView";
import { useLandingRecentFiles } from "./hooks/useLandingRecentFiles";
import type { LandingPageProps } from "./types";

export type { LandingPageProps } from "./types";

const LandingPage: React.FC<LandingPageProps> = ({
  onUpload,
  onOpen,
  onOpenRecent,
  hasSavedSession,
  onResume,
}) => {
  const { t } = useLanguage();
  const {
    recentFiles,
    query,
    setQuery,
    filteredRecentFiles,
    handleDeleteRecent,
    handleClearAll,
    handleOpenRecent,
  } = useLandingRecentFiles({
    onOpenRecent,
    t,
  });

  return (
    <PlatformSwitch
      desktop={
        <DesktopLandingView
          query={query}
          recentFiles={recentFiles}
          filteredRecentFiles={filteredRecentFiles}
          onQueryChange={setQuery}
          onClearQuery={() => setQuery("")}
          onOpen={onOpen}
          onOpenRecent={handleOpenRecent}
          onDeleteRecent={handleDeleteRecent}
          onClearAll={handleClearAll}
          t={t}
        />
      }
      web={
        <WebLandingView
          hasSavedSession={hasSavedSession}
          onOpen={onOpen}
          onResume={onResume}
          onUpload={onUpload}
          t={t}
        />
      }
    />
  );
};

export default LandingPage;
