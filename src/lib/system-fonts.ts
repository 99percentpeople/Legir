import {
  getPlatformSystemFontCatalog,
  type PlatformSystemFontCatalog,
} from "@/services/platform";

let cachedCatalogPromise: Promise<PlatformSystemFontCatalog> | null = null;

export const getSystemFontCatalog = async () => {
  if (!cachedCatalogPromise) {
    cachedCatalogPromise = getPlatformSystemFontCatalog();
  }

  try {
    return await cachedCatalogPromise;
  } catch {
    cachedCatalogPromise = null;
    return { families: [], aliases: {} };
  }
};

export const getSystemFontFamilies = async (): Promise<string[]> => {
  return (await getSystemFontCatalog()).families;
};

export const getSystemFontAliasToFamilyCompact = async (): Promise<
  Record<string, string>
> => {
  return (await getSystemFontCatalog()).aliases;
};
