import { isTauri, invoke } from "@tauri-apps/api/core";

let cachedFamiliesPromise: Promise<string[]> | null = null;
let cachedAliasMapPromise: Promise<Record<string, string>> | null = null;

export const getSystemFontFamilies = async (): Promise<string[]> => {
  if (!isTauri()) return [];

  if (!cachedFamiliesPromise) {
    cachedFamiliesPromise = invoke<string[]>("list_system_font_families").then(
      (families) =>
        Array.isArray(families)
          ? families
              .filter((f) => typeof f === "string")
              .map((f) => f.trim())
              .filter((f) => f.length > 0)
          : [],
    );
  }

  try {
    return await cachedFamiliesPromise;
  } catch {
    cachedFamiliesPromise = null;
    return [];
  }
};

export const getSystemFontAliasToFamilyCompact = async (): Promise<
  Record<string, string>
> => {
  if (!isTauri()) return {};

  if (!cachedAliasMapPromise) {
    cachedAliasMapPromise = invoke<unknown>(
      "list_system_font_aliases_compact",
    ).then((raw) => {
      if (!raw || typeof raw !== "object") return {};

      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof k !== "string") continue;
        if (typeof v !== "string") continue;
        const kk = k.trim();
        const vv = v.trim();
        if (!kk || !vv) continue;
        out[kk] = vv;
      }
      return out;
    });
  }

  try {
    return await cachedAliasMapPromise;
  } catch {
    cachedAliasMapPromise = null;
    return {};
  }
};
