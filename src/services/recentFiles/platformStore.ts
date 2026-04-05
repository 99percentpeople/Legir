import { recentFilesService } from "@/services/recentFilesService";
import type { RecentFilesStore } from "./types";

export const createPlatformRecentFilesStore = (): RecentFilesStore => ({
  list: async () =>
    recentFilesService.getAll().map((entry) => ({
      ...entry,
      locationLabel: entry.locationLabel,
    })),
  remove: async (path) => recentFilesService.remove(path),
  clear: async () => recentFilesService.clear(),
  upsert: async (entry) =>
    recentFilesService.upsert({
      path: entry.path,
      filename: entry.filename,
      locationLabel: entry.locationLabel,
      lastOpenedAt: entry.lastOpenedAt,
    }),
  subscribe: (listener) => recentFilesService.subscribe(listener),
});
