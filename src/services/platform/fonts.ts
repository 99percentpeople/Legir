import { invoke } from "@tauri-apps/api/core";

import { isDesktopApp } from "./runtime";

const normalizeFontBytes = (value: Uint8Array | number[] | null) => {
  if (!value) return undefined;
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return new Uint8Array(value);
  return undefined;
};

export const getPlatformSystemFontFamilies = async (): Promise<string[]> => {
  if (!isDesktopApp()) return [];

  const families = await invoke<string[]>("list_system_font_families");
  return Array.isArray(families)
    ? families
        .filter((family) => typeof family === "string")
        .map((family) => family.trim())
        .filter((family) => family.length > 0)
    : [];
};

export const getPlatformSystemFontAliasToFamilyCompact = async (): Promise<
  Record<string, string>
> => {
  if (!isDesktopApp()) return {};

  const raw = await invoke<unknown>("list_system_font_aliases_compact");
  if (!raw || typeof raw !== "object") return {};

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== "string" || typeof value !== "string") continue;
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();
    if (!normalizedKey || !normalizedValue) continue;
    out[normalizedKey] = normalizedValue;
  }
  return out;
};

export const getPlatformSystemFontBytes = async (args: {
  families: string[];
  generic: "serif" | "sans-serif" | null;
}): Promise<Uint8Array | undefined> => {
  if (!isDesktopApp()) return undefined;

  const result = await invoke<Uint8Array | number[] | null>(
    "get_system_font_bytes",
    {
      families: args.families,
      generic: args.generic,
    },
  );

  return normalizeFontBytes(result);
};
