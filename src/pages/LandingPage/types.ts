import type { useLanguage } from "@/components/language-provider";

export interface LandingPageProps {
  onUpload: (file: File) => void;
  onOpen?: () => Promise<void>;
  onOpenRecent?: (filePath: string) => Promise<void>;
  hasSavedSession?: boolean;
  onResume?: () => void;
}

export type LandingTranslation = ReturnType<typeof useLanguage>["t"];
