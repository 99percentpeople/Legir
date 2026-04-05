import { FolderOpen, Search, Trash2, X } from "lucide-react";
import { HomeHeader } from "@/components/home/HomeHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimeAgoText } from "@/components/timeText";
import type { RecentFileEntry } from "@/services/recentFiles";
import type { HomePageTranslation } from "./types";

interface RecentFilesHomeViewProps {
  query: string;
  recentFiles: RecentFileEntry[];
  filteredRecentFiles: RecentFileEntry[];
  onQueryChange: (value: string) => void;
  onClearQuery: () => void;
  onOpen: () => Promise<void>;
  onOpenRecent: (entry: RecentFileEntry) => Promise<void>;
  onDeleteRecent: (path: string) => void | Promise<void>;
  onClearAll: () => void | Promise<void>;
  t: HomePageTranslation;
}

export function RecentFilesHomeView({
  query,
  recentFiles,
  filteredRecentFiles,
  onQueryChange,
  onClearQuery,
  onOpen,
  onOpenRecent,
  onDeleteRecent,
  onClearAll,
  t,
}: RecentFilesHomeViewProps) {
  return (
    <div className="bg-background flex min-h-screen flex-col transition-colors duration-200">
      <HomeHeader />

      <div className="flex flex-1 flex-col gap-6 p-6 pt-24">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <h1 className="text-foreground text-2xl font-bold tracking-tight">
              {t("home.desktop.recent_title")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t("home.desktop.recent_subtitle")}
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-80">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder={t("home.desktop.search_placeholder")}
                className="pl-9"
              />
              {query.trim() ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                  onClick={onClearQuery}
                >
                  <X />
                </Button>
              ) : null}
            </div>

            <div className="flex gap-2">
              <Button onClick={() => void onOpen()} className="gap-2">
                <FolderOpen />
                {t("home.desktop.open_pdf")}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  void onClearAll();
                }}
                className="gap-2"
                disabled={recentFiles.length === 0}
              >
                <Trash2 />
                {t("home.desktop.clear_all")}
              </Button>
            </div>
          </div>
        </div>

        <div className="border-border bg-card rounded-xl border">
          <div className="border-border flex items-center justify-between border-b p-4">
            <div className="text-sm font-medium">
              {t("home.desktop.file_count", {
                count: filteredRecentFiles.length,
              })}
            </div>
          </div>

          <div className="divide-border divide-y">
            {filteredRecentFiles.length === 0 ? (
              <div className="text-muted-foreground p-6 text-sm">
                {t("home.desktop.no_recent_files")}
              </div>
            ) : (
              filteredRecentFiles.map((entry) => (
                <div
                  key={entry.path}
                  tabIndex={0}
                  className="group hover:bg-accent/40 flex items-center justify-between gap-4 p-4 transition-colors outline-none"
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="bg-muted ring-border relative h-16 w-16 shrink-0 overflow-hidden rounded-md ring-1">
                      {entry.previewDataUrl ? (
                        <img
                          src={entry.previewDataUrl}
                          alt={entry.filename}
                          className="h-full w-full object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <div className="text-muted-foreground flex h-full w-full items-center justify-center text-xs">
                          {t("home.desktop.pdf_badge")}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="text-foreground truncate font-medium">
                        {entry.filename}
                      </div>
                      <div className="text-muted-foreground truncate text-xs">
                        {entry.locationLabel}
                      </div>
                      <div className="text-muted-foreground mt-1 text-xs">
                        <TimeAgoText time={entry.lastOpenedAt} />
                      </div>
                    </div>
                  </div>

                  <div className="invisible flex shrink-0 items-center gap-2 opacity-0 transition-all duration-200 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        void onOpenRecent(entry);
                      }}
                    >
                      {t("home.desktop.open")}
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon"
                      onClick={() => {
                        void onDeleteRecent(entry.path);
                      }}
                      aria-label={t("common.actions.delete")}
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
