import { BUILT_IN_EXPORT_FONTS } from "./built-in-fonts";

const normalizePdfFontNameForLookup = (name: string) => {
  const trimmed = name.trim();
  const noSubset = trimmed.includes("+")
    ? trimmed.split("+").slice(1).join("+")
    : trimmed;
  return noSubset.replace(/^\//, "");
};

export const normalizePdfFontName = (name: string) =>
  normalizePdfFontNameForLookup(name);

const toCompactFontName = (name: string) => {
  const normalized = normalizePdfFontNameForLookup(name);
  return normalized.toUpperCase().replace(/[^A-Z0-9]+/g, "");
};

export const matchSystemFontFamily = (
  pdfFontName: string | undefined,
  systemFamilies: string[] | undefined,
) => {
  if (!pdfFontName) return undefined;
  if (!systemFamilies || systemFamilies.length === 0) return undefined;

  const needle = toCompactFontName(pdfFontName);
  if (!needle) return undefined;

  for (const fam of systemFamilies) {
    if (typeof fam !== "string") continue;
    const c = toCompactFontName(fam);
    if (!c) continue;
    if (c === needle) return fam;
    if (c.includes(needle)) return fam;
    if (needle.includes(c)) return fam;
  }

  return undefined;
};

export const matchSystemFontFamilyByAlias = (
  pdfFontName: string | undefined,
  aliasToFamilyCompact: Record<string, string> | undefined,
) => {
  if (!pdfFontName) return undefined;
  if (!aliasToFamilyCompact) return undefined;

  const needle = toCompactFontName(pdfFontName);
  if (!needle) return undefined;

  const direct = aliasToFamilyCompact[needle];
  if (typeof direct === "string" && direct.trim()) return direct;

  // Fuzzy match for cases where the PDF name contains extra suffixes.
  // Keys are already compacted (A-Z0-9 only).
  for (const [k, fam] of Object.entries(aliasToFamilyCompact)) {
    if (!k) continue;
    if (k === needle || k.includes(needle) || needle.includes(k)) {
      if (typeof fam === "string" && fam.trim()) return fam;
    }
  }

  return undefined;
};

export const pdfFontToAppFontKey = (pdfFontName: string | undefined) => {
  if (!pdfFontName) return undefined;
  const normalized = normalizePdfFontNameForLookup(pdfFontName);
  const upper = normalized.toUpperCase();
  const compact = upper.replace(/[^A-Z0-9]+/g, "");

  if (
    upper === "HELV" ||
    upper === "HELVETICA" ||
    upper.includes("HELVETICA")
  ) {
    return "Helvetica";
  }
  if (
    upper === "TIRO" ||
    upper.includes("TIMES") ||
    upper.includes("TIMESROMAN")
  ) {
    return "Times Roman";
  }
  if (upper === "COUR" || upper.includes("COURIER")) {
    return "Courier";
  }

  // Data-driven mapping for embedded/built-in fonts.
  // When you add new fonts, extend BUILT_IN_EXPORT_FONTS with `importAliases`.
  for (const def of BUILT_IN_EXPORT_FONTS) {
    // Match against the configured display name and any known aliases.
    const candidates = [def.name, ...(def.importAliases || [])];
    for (const c of candidates) {
      const cUpper = (c || "").toUpperCase();
      const cCompact = cUpper.replace(/[^A-Z0-9]+/g, "");
      if (!cCompact) continue;

      // `includes` handles suffixes like -Regular and PDF PS naming variations.
      if (compact.includes(cCompact)) return def.name;
    }
  }

  return undefined;
};

export const pdfFontToCssFontFamily = (pdfFontName: string | undefined) => {
  if (!pdfFontName) return undefined;
  const normalized = normalizePdfFontNameForLookup(pdfFontName);
  const upper = normalized.toUpperCase();

  if (upper.includes("HELVETICA") || upper === "HELV") {
    return "Helvetica, Arial, sans-serif";
  }
  if (upper.includes("TIMES") || upper.includes("TIMESROMAN")) {
    return '"Times New Roman", Times, serif';
  }
  if (upper.includes("COURIER")) {
    return '"Courier New", Courier, monospace';
  }

  return `"${normalized}", Helvetica, Arial, sans-serif`;
};
