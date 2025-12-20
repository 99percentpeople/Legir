import React, { useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  FileText,
  Shield,
  FileType,
  History,
  FolderOpen,
  Trash2,
  Search,
  X,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { ModeToggle } from "../components/toolbar/mode-toggle";
import { LanguageToggle } from "../components/toolbar/language-toggle";
import PDFUploader from "../components/PDFUploader";
import { useLanguage } from "../components/language-provider";
import { isTauri } from "@tauri-apps/api/core";
import { Input } from "../components/ui/input";
import {
  clearRecentFiles,
  getRecentFiles,
  removeRecentFile,
  type RecentFileEntry,
} from "../services/recentFilesService";
import { toast } from "sonner";
import dayjs from "dayjs";
import { confirm } from "@tauri-apps/plugin-dialog";
export interface LandingPageProps {
  onUpload: (file: File) => void;
  onOpen?: () => Promise<void>;
  onOpenRecent?: (filePath: string) => Promise<void>;
  hasSavedSession?: boolean;
  onResume?: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({
  onUpload,
  onOpen,
  onOpenRecent,
  hasSavedSession,
  onResume,
}) => {
  const { t } = useLanguage();

  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>([]);
  const [query, setQuery] = useState("");

  const isDesktop = isTauri();

  useEffect(() => {
    if (!isDesktop) return;
    setRecentFiles(getRecentFiles());
  }, [isDesktop]);

  const filteredRecentFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recentFiles;
    return recentFiles.filter((r) => {
      return (
        r.filename.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)
      );
    });
  }, [query, recentFiles]);

  const handleDeleteRecent = (path: string) => {
    const next = removeRecentFile(path);
    setRecentFiles(next);
  };

  const handleClearAll = async () => {
    const ok = await confirm(t("landing.desktop.confirm_clear_all"));
    if (!ok) return;
    const next = clearRecentFiles();
    setRecentFiles(next);
  };

  const handleOpenRecent = async (entry: RecentFileEntry) => {
    if (!onOpenRecent) return;
    try {
      await onOpenRecent(entry.path);
    } catch (e: any) {
      toast.error(e?.message || t("landing.desktop.open_fail"));
    }
  };

  if (isDesktop) {
    return (
      <div className="bg-background flex min-h-screen flex-col transition-colors duration-200">
        <div className="border-border bg-card/50 fixed top-0 z-50 flex h-16 w-full items-center justify-between border-b px-6 backdrop-blur-sm">
          <div className="text-foreground flex items-center gap-2 text-xl font-bold">
            <div className="bg-primary text-primary-foreground rounded-md p-1.5">
              <FileType size={20} strokeWidth={2.5} />
            </div>
            <span>{t("app.name")}</span>
          </div>
          <div className="flex items-center gap-2">
            <LanguageToggle />
            <ModeToggle />
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-6 p-6 pt-24">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <h1 className="text-foreground text-2xl font-bold tracking-tight">
                {t("landing.desktop.recent_title")}
              </h1>
              <p className="text-muted-foreground text-sm">
                {t("landing.desktop.recent_subtitle")}
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-80">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("landing.desktop.search_placeholder")}
                  className="pl-9"
                />
                {query.trim() ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="absolute top-1/2 right-1 -translate-y-1/2"
                    onClick={() => setQuery("")}
                  >
                    <X />
                  </Button>
                ) : null}
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => void onOpen?.()}
                  className="gap-2"
                  disabled={!onOpen}
                >
                  <FolderOpen />
                  {t("landing.desktop.open_pdf")}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleClearAll}
                  className="gap-2"
                  disabled={recentFiles.length === 0}
                >
                  <Trash2 />
                  {t("landing.desktop.clear_all")}
                </Button>
              </div>
            </div>
          </div>

          <div className="border-border bg-card rounded-xl border">
            <div className="border-border flex items-center justify-between border-b p-4">
              <div className="text-sm font-medium">
                {t("landing.desktop.file_count", {
                  count: filteredRecentFiles.length,
                })}
              </div>
            </div>

            <div className="divide-border divide-y">
              {filteredRecentFiles.length === 0 ? (
                <div className="text-muted-foreground p-6 text-sm">
                  {t("landing.desktop.no_recent_files")}
                </div>
              ) : (
                filteredRecentFiles.map((entry) => (
                  <div
                    key={entry.path}
                    className="hover:bg-accent/40 flex items-center justify-between gap-4 p-4 transition-colors"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <div className="bg-muted ring-border relative h-16 w-16 shrink-0 overflow-hidden rounded-md ring-1">
                        {entry.thumbnailDataUrl ? (
                          <img
                            src={entry.thumbnailDataUrl}
                            alt={entry.filename}
                            className="h-full w-full object-contain"
                            loading="lazy"
                          />
                        ) : (
                          <div className="text-muted-foreground flex h-full w-full items-center justify-center text-xs">
                            {t("landing.desktop.pdf_badge")}
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="text-foreground truncate font-medium">
                          {entry.filename}
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                          {entry.path}
                        </div>
                        <div className="text-muted-foreground mt-1 text-xs">
                          {dayjs(entry.lastOpenedAt).fromNow()}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => void handleOpenRecent(entry)}
                        disabled={!onOpenRecent}
                      >
                        {t("landing.desktop.open")}
                      </Button>
                      <Button
                        variant="destructive"
                        size="icon"
                        onClick={() => handleDeleteRecent(entry.path)}
                        aria-label={t("common.delete")}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background flex min-h-screen flex-col transition-colors duration-200">
      {/* Header */}
      <div className="border-border bg-card/50 fixed top-0 z-50 flex h-16 w-full items-center justify-between border-b px-6 backdrop-blur-sm">
        <div className="text-foreground flex items-center gap-2 text-xl font-bold">
          <div className="bg-primary text-primary-foreground rounded-md p-1.5">
            <FileType size={20} strokeWidth={2.5} />
          </div>
          <span>{t("app.name")}</span>
        </div>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <ModeToggle />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 flex-col items-center justify-center gap-12 p-6 pt-24">
        <div className="animate-in fade-in slide-in-from-bottom-4 max-w-3xl space-y-4 text-center duration-700">
          <h1 className="from-primary bg-linear-to-r to-blue-600 bg-clip-text pb-2 text-4xl font-extrabold tracking-tight text-transparent lg:text-6xl">
            {t("landing.title")}
          </h1>
          <p className="text-muted-foreground text-xl">
            {t("landing.subtitle")}
          </p>
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-8 flex w-full max-w-2xl flex-col items-center gap-4 delay-150 duration-700">
          <PDFUploader onUpload={onUpload} onOpen={onOpen} />

          {hasSavedSession && onResume && (
            <Button
              onClick={onResume}
              variant="outline"
              className="border-primary/50 hover:border-primary text-primary mt-2 w-full gap-2 border-dashed md:w-auto"
            >
              <History size={16} />
              {t("landing.resume_session")}
            </Button>
          )}
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-8 mt-4 grid w-full max-w-5xl grid-cols-1 gap-6 delay-300 duration-700 md:grid-cols-3">
          <FeatureCard
            icon={<Sparkles className="text-purple-500" size={24} />}
            title={t("landing.feature.ai.title")}
            desc={t("landing.feature.ai.desc")}
          />
          <FeatureCard
            icon={<FileText className="text-blue-500" size={24} />}
            title={t("landing.feature.editor.title")}
            desc={t("landing.feature.editor.desc")}
          />
          <FeatureCard
            icon={<Shield className="text-green-500" size={24} />}
            title={t("landing.feature.local.title")}
            desc={t("landing.feature.local.desc")}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="text-muted-foreground border-border bg-muted/20 border-t py-6 text-center text-sm">
        <p>
          {t("landing.footer.copyright", {
            year: new Date().getFullYear(),
            appName: t("app.name"),
          })}
        </p>
      </div>
    </div>
  );
};

const FeatureCard = ({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) => (
  <div className="bg-card hover:bg-accent/50 border-border group flex flex-col items-center gap-3 rounded-xl border p-6 text-center transition-colors">
    <div className="bg-background ring-border rounded-full p-3 shadow-sm ring-1 transition-transform duration-300 group-hover:scale-110">
      {icon}
    </div>
    <h3 className="text-lg font-semibold">{title}</h3>
    <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
  </div>
);

export default LandingPage;
