import type { StampImageResource } from "@/types";

export interface StampLibraryEntry {
  id: string;
  name: string;
  image: StampImageResource;
  createdAt: number;
  lastUsedAt?: number;
}
