import { create } from "zustand";
import {
  compareStampLibraryEntries,
  deleteStampLibraryImage,
  markStampLibraryImageUsed,
  readStampLibrary,
  saveStampLibraryImage,
} from "@/services/stampLibrary";
import type { StampLibraryEntry } from "@/services/stampLibrary/types";
import type { StampImageResource } from "@/types";

interface StampLibraryState {
  entries: StampLibraryEntry[];
  refresh: () => Promise<void>;
  add: (
    name: string,
    image: StampImageResource,
    file?: File,
  ) => Promise<StampLibraryEntry>;
  remove: (id: string) => Promise<void>;
  markUsed: (id: string) => Promise<void>;
}

export const useStampLibraryStore = create<StampLibraryState>((set, get) => ({
  entries: [],
  refresh: async () => {
    const entries = await readStampLibrary();
    set({ entries });
  },
  add: async (name, image, file) => {
    const entry = await saveStampLibraryImage(name, image, file);
    await get().refresh();
    return entry;
  },
  remove: async (id) => {
    await deleteStampLibraryImage(id);
    await get().refresh();
  },
  markUsed: async (id) => {
    const entry = await markStampLibraryImageUsed(id);
    if (!entry) return;
    set((state) => ({
      entries: state.entries
        .map((item) => (item.id === id ? entry : item))
        .sort(compareStampLibraryEntries),
    }));
  },
}));
