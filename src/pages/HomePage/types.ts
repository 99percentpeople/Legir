import type { useLanguage } from "@/components/language-provider";
import type { RecentFileEntry, RecentFilesStore } from "@/services/recentFiles";

export interface HomePageAdapter {
  store: RecentFilesStore;
  open: () => Promise<void>;
  openRecent: (entry: RecentFileEntry) => Promise<void>;
  confirmClearAll: (message: string) => Promise<boolean>;
}

export interface HomePageProps {
  adapter: HomePageAdapter;
}

export type HomePageTranslation = ReturnType<typeof useLanguage>["t"];
