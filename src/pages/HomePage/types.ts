import type { useLanguage } from "@/components/language-provider";
import type { PlatformDroppedPdf } from "@/services/platform";
import type { RecentFileEntry, RecentFilesStore } from "@/services/recentFiles";

export interface HomePageAdapter {
  store: RecentFilesStore;
  open: () => Promise<void>;
  openRecent: (entry: RecentFileEntry) => Promise<void>;
  openDroppedPdfs: (payloads: PlatformDroppedPdf[]) => Promise<void>;
  confirmClearAll: (message: string) => Promise<boolean>;
}

export interface HomePageProps {
  adapter: HomePageAdapter;
}

export type HomeRecentFilesViewMode = "list" | "grid";

export type HomePageTranslation = ReturnType<typeof useLanguage>["t"];
