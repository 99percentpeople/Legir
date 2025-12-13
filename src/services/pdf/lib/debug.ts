export type PdfDebugEntry = {
  category: string;
  event: string;
  data?: unknown;
  time: string;
};

export type PdfDebugConfig = {
  enabled?: boolean;
  categories?: string[];
  filter?: (entry: PdfDebugEntry) => boolean;
  callback?: (entry: PdfDebugEntry) => void;
};

const getConfig = (): PdfDebugConfig | undefined => {
  try {
    return (globalThis as any).__FF_PDF_DEBUG as PdfDebugConfig | undefined;
  } catch {
    return undefined;
  }
};

const legacyEnabled = () => {
  try {
    const g = globalThis as any;
    return (
      g?.__FF_DEBUG_PDF_IMPORT_COLORS === true ||
      g?.__FF_DEBUG_PDF_IMPORT === true
    );
  } catch {
    return false;
  }
};

export const pdfDebugEnabled = (category: string) => {
  const cfg = getConfig();
  if (cfg?.enabled === true) {
    const cats = cfg.categories;
    if (!cats || cats.length === 0) return true;
    return cats.some((c) => category.startsWith(c));
  }
  return legacyEnabled();
};

export const pdfDebug = (category: string, event: string, data?: unknown) => {
  if (!pdfDebugEnabled(category)) return;

  const entry: PdfDebugEntry = {
    category,
    event,
    data,
    time: new Date().toISOString(),
  };

  const cfg = getConfig();
  if (cfg?.filter && !cfg.filter(entry)) return;
  if (cfg?.callback) {
    cfg.callback(entry);
  } else {
    console.debug(`[PDF Debug] ${category}:${event}`, data);
  }
};

export const setPdfDebugConfig = (config: PdfDebugConfig | undefined) => {
  (globalThis as any).__FF_PDF_DEBUG = config;
};
