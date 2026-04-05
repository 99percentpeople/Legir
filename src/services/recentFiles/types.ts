export type RecentFileEntry = {
  path: string;
  filename: string;
  locationLabel: string;
  lastOpenedAt: number;
  previewDataUrl?: string;
  previewUpdatedAt?: number;
};

export type RecentFilesStoreListener = (entries: RecentFileEntry[]) => void;

export interface RecentFilesStore {
  list: () => Promise<RecentFileEntry[]>;
  remove: (entryId: string) => Promise<RecentFileEntry[]>;
  clear: () => Promise<RecentFileEntry[]>;
  upsert: (entry: {
    path: string;
    filename: string;
    locationLabel: string;
    lastOpenedAt?: number;
    previewDataUrl?: string;
    previewUpdatedAt?: number;
  }) => Promise<RecentFileEntry[]>;
  subscribe: (listener: RecentFilesStoreListener) => () => void;
}
