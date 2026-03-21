import {
  getPlatformSystemFontAliasToFamilyCompact,
  getPlatformSystemFontFamilies,
} from "@/services/platform";

let cachedFamiliesPromise: Promise<string[]> | null = null;
let cachedAliasMapPromise: Promise<Record<string, string>> | null = null;

export const getSystemFontFamilies = async (): Promise<string[]> => {
  if (!cachedFamiliesPromise) {
    cachedFamiliesPromise = getPlatformSystemFontFamilies();
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
  if (!cachedAliasMapPromise) {
    cachedAliasMapPromise = getPlatformSystemFontAliasToFamilyCompact();
  }

  try {
    return await cachedAliasMapPromise;
  } catch {
    cachedAliasMapPromise = null;
    return {};
  }
};
