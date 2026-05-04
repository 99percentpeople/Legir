import type { SyntheticEvent } from "react";
import {
  FileIcon,
  FolderOpen,
  LayoutGrid,
  List,
  MoreHorizontal,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { HomeHeader } from "@/components/home/HomeHeader";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TimeAgoText } from "@/components/timeText";
import type { RecentFileEntry } from "@/services/recentFiles";
import { cn } from "@/utils/cn";
import type { HomeRecentFilesViewMode } from "./types";

interface RecentFilesHomeViewProps {
  query: string;
  filteredRecentFiles: RecentFileEntry[];
  viewMode: HomeRecentFilesViewMode;
  canClearAll: boolean;
  onQueryChange: (value: string) => void;
  onClearQuery: () => void;
  onOpen: () => Promise<void>;
  onOpenRecent: (entry: RecentFileEntry) => Promise<void>;
  onDeleteRecent: (path: string) => void | Promise<void>;
  onClearAll: () => void | Promise<void>;
  onViewModeChange: (viewMode: HomeRecentFilesViewMode) => void;
}

const isRecentFilesViewMode = (
  value: string,
): value is HomeRecentFilesViewMode => value === "list" || value === "grid";

const stopEntryActivation = (event: SyntheticEvent) => {
  event.stopPropagation();
};

const RecentFilePreview = ({
  entry,
  className,
}: {
  entry: RecentFileEntry;
  className?: string;
}) => {
  const { t } = useLanguage();

  return (
    <div
      className={cn(
        "bg-muted ring-border relative shrink-0 overflow-hidden rounded-md ring-1",
        className,
      )}
    >
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
  );
};

const RecentFileActionsMenu = ({
  entry,
  onOpenRecent,
  onDeleteRecent,
}: {
  entry: RecentFileEntry;
  onOpenRecent: (entry: RecentFileEntry) => Promise<void>;
  onDeleteRecent: (path: string) => void | Promise<void>;
}) => {
  const { t } = useLanguage();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={t("home.desktop.file_actions")}
          title={t("home.desktop.file_actions")}
          onClick={stopEntryActivation}
          onDoubleClick={stopEntryActivation}
          onKeyDown={stopEntryActivation}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            void onOpenRecent(entry);
          }}
        >
          <FolderOpen size={14} />
          <span>{t("home.desktop.open")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={(event) => {
            event.stopPropagation();
            void onDeleteRecent(entry.path);
          }}
        >
          <Trash2 size={14} />
          <span>{t("common.actions.delete")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface RecentFilesDisplayProps {
  entries: RecentFileEntry[];
  onOpenRecent: (entry: RecentFileEntry) => Promise<void>;
  onDeleteRecent: (path: string) => void | Promise<void>;
}

const RecentFilesGrid = ({
  entries,
  onOpenRecent,
  onDeleteRecent,
}: RecentFilesDisplayProps) => (
  <div className="grid gap-6 p-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
    {entries.map((entry) => (
      <div
        key={entry.path}
        tabIndex={0}
        className="border-border bg-background hover:bg-accent/40 flex min-w-0 flex-col overflow-hidden rounded-lg border transition-colors outline-none"
        onDoubleClick={() => {
          void onOpenRecent(entry);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            void onOpenRecent(entry);
          }
        }}
      >
        <RecentFilePreview
          entry={entry}
          className="aspect-[4/3] w-full rounded-none ring-0"
        />

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-foreground truncate font-medium">
                {entry.filename}
              </div>
              <div className="text-muted-foreground mt-1 truncate text-xs">
                {entry.locationLabel}
              </div>
              <div className="text-muted-foreground mt-2 text-xs">
                <TimeAgoText time={entry.lastOpenedAt} />
              </div>
            </div>

            <RecentFileActionsMenu
              entry={entry}
              onOpenRecent={onOpenRecent}
              onDeleteRecent={onDeleteRecent}
            />
          </div>
        </div>
      </div>
    ))}
  </div>
);

const RecentFilesList = ({
  entries,
  onOpenRecent,
  onDeleteRecent,
}: RecentFilesDisplayProps) => {
  const { t } = useLanguage();

  return (
    <div>
      <div className="border-border text-muted-foreground hidden grid-cols-[5rem_minmax(0,1fr)_10rem_2rem] items-center gap-4 border-b px-4 py-2 text-xs font-medium md:grid">
        <div>
          <FileIcon className="size-4" />
        </div>
        <div>{t("home.desktop.list_column_name")}</div>
        <div>{t("home.desktop.list_column_time")}</div>
        <div aria-hidden="true" />
      </div>

      <div className="divide-border divide-y">
        {entries.map((entry) => (
          <div
            key={entry.path}
            tabIndex={0}
            className="hover:bg-accent/40 flex items-center justify-between gap-4 p-4 transition-colors outline-none md:grid md:grid-cols-[5rem_minmax(0,1fr)_10rem_2rem] md:items-center"
            onDoubleClick={() => {
              void onOpenRecent(entry);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void onOpenRecent(entry);
              }
            }}
          >
            <RecentFilePreview entry={entry} className="h-16 w-16" />

            <div className="min-w-0 flex-1 md:block">
              <div className="text-foreground truncate font-medium">
                {entry.filename}
              </div>
              <div className="text-muted-foreground truncate text-xs">
                {entry.locationLabel}
              </div>
              <div className="text-muted-foreground mt-1 text-xs md:hidden">
                <TimeAgoText time={entry.lastOpenedAt} />
              </div>
            </div>

            <div className="text-muted-foreground hidden text-xs md:block">
              <TimeAgoText time={entry.lastOpenedAt} />
            </div>

            <div className="flex justify-end">
              <RecentFileActionsMenu
                entry={entry}
                onOpenRecent={onOpenRecent}
                onDeleteRecent={onDeleteRecent}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export function RecentFilesHomeView({
  query,
  filteredRecentFiles,
  viewMode,
  canClearAll,
  onQueryChange,
  onClearQuery,
  onOpen,
  onOpenRecent,
  onDeleteRecent,
  onClearAll,
  onViewModeChange,
}: RecentFilesHomeViewProps) {
  const { t } = useLanguage();

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
                disabled={!canClearAll}
              >
                <Trash2 />
                {t("home.desktop.clear_all")}
              </Button>
            </div>
          </div>
        </div>

        <div className="border-border bg-card rounded-xl border">
          <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div className="text-sm font-medium">
              {t("home.desktop.file_count", {
                count: filteredRecentFiles.length,
              })}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <ToggleGroup
                type="single"
                value={viewMode}
                onValueChange={(value) => {
                  if (isRecentFilesViewMode(value)) {
                    onViewModeChange(value);
                  }
                }}
                variant="outline"
                size="sm"
                aria-label={t("home.desktop.view_mode")}
              >
                <ToggleGroupItem
                  value="list"
                  title={t("home.desktop.view_list")}
                  aria-label={t("home.desktop.view_list")}
                  className="w-8"
                >
                  <List />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="grid"
                  title={t("home.desktop.view_grid")}
                  aria-label={t("home.desktop.view_grid")}
                  className="w-8"
                >
                  <LayoutGrid />
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>

          {filteredRecentFiles.length === 0 ? (
            <div className="text-muted-foreground p-6 text-sm">
              {t("home.desktop.no_recent_files")}
            </div>
          ) : viewMode === "grid" ? (
            <RecentFilesGrid
              entries={filteredRecentFiles}
              onOpenRecent={onOpenRecent}
              onDeleteRecent={onDeleteRecent}
            />
          ) : (
            <RecentFilesList
              entries={filteredRecentFiles}
              onOpenRecent={onOpenRecent}
              onDeleteRecent={onDeleteRecent}
            />
          )}
        </div>
      </div>
    </div>
  );
}
