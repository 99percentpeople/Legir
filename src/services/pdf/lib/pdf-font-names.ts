const normalizePdfFontNameForLookup = (name: string) => {
  const trimmed = name.trim();
  const noSubset = trimmed.includes("+")
    ? trimmed.split("+").slice(1).join("+")
    : trimmed;
  return noSubset.replace(/^\//, "");
};

export const normalizePdfFontName = (name: string) =>
  normalizePdfFontNameForLookup(name);

export const pdfFontToAppFontKey = (pdfFontName: string | undefined) => {
  if (!pdfFontName) return undefined;
  const normalized = normalizePdfFontNameForLookup(pdfFontName);
  const upper = normalized.toUpperCase();

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
