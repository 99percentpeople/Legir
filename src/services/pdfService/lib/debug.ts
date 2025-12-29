export type PdfDebugEntry = {
  category: string;
  event: string;
  data?: unknown;
  getData?: () => unknown;
  time: string;
};

export type PdfDebugEntryMeta = {
  category: string;
  event: string;
  time: string;
};

export type PdfDebugDataFactory = () => unknown;
export type PdfDebugDataArg = unknown | PdfDebugDataFactory;

export type PdfDebugConfig = {
  enabled?: boolean;
  categories?: string[];
  filterMeta?: (meta: PdfDebugEntryMeta) => boolean;
  filter?: (entry: PdfDebugEntry) => boolean;
  callback?: (entry: PdfDebugEntry) => void;
};

type DebugGlobals = {
  __FF_PDF_DEBUG?: PdfDebugConfig;
  __FF_DEBUG_PDF_IMPORT_COLORS?: boolean;
  __FF_DEBUG_PDF_IMPORT?: boolean;
};

const getConfig = (): PdfDebugConfig | undefined => {
  try {
    const g = globalThis as unknown as DebugGlobals;
    return g.__FF_PDF_DEBUG;
  } catch {
    return undefined;
  }
};

const legacyEnabled = () => {
  try {
    const g = globalThis as unknown as DebugGlobals;
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

export const pdfDebug = (
  category: string,
  event: string,
  data?: PdfDebugDataArg,
) => {
  if (!pdfDebugEnabled(category)) return;

  const time = new Date().toISOString();

  const cfg = getConfig();

  const meta: PdfDebugEntryMeta = { category, event, time };
  if (cfg?.filterMeta && !cfg.filterMeta(meta)) return;

  let computed = false;
  let cached: unknown = undefined;
  const compute = () => {
    if (!computed) {
      cached =
        typeof data === "function" ? (data as PdfDebugDataFactory)() : data;
      computed = true;
    }
    return cached;
  };

  const entry: PdfDebugEntry = {
    category,
    event,
    time,
    getData: compute,
  };
  Object.defineProperty(entry, "data", {
    enumerable: true,
    configurable: true,
    get: compute,
  });

  if (cfg?.filter && !cfg.filter(entry)) return;
  if (cfg?.callback) {
    cfg.callback(entry);
    return;
  }

  console.debug(`[PDF Debug] ${category}:${event}`, compute());
};

export type PdfDebugLogger = {
  (event: string, data?: PdfDebugDataArg): void;
  enabled: () => boolean;
  child: (suffix: string) => PdfDebugLogger;
};

export const createPdfDebug = (category: string): PdfDebugLogger => {
  const fn = ((event: string, data?: PdfDebugDataArg) => {
    pdfDebug(category, event, data);
  }) as PdfDebugLogger;
  fn.enabled = () => pdfDebugEnabled(category);
  fn.child = (suffix: string) => createPdfDebug(`${category}:${suffix}`);
  return fn;
};

export const setPdfDebugConfig = (config: PdfDebugConfig | undefined) => {
  const g = globalThis as unknown as DebugGlobals;
  g.__FF_PDF_DEBUG = config;
};

export const enablePdfDebug = (categories?: string[]) => {
  const prev = getConfig() || {};
  setPdfDebugConfig({ ...prev, enabled: true, categories });
};

export const disablePdfDebug = () => {
  const prev = getConfig() || {};
  setPdfDebugConfig({ ...prev, enabled: false });
};

export const setPdfDebugCategories = (categories?: string[]) => {
  const prev = getConfig() || {};
  setPdfDebugConfig({ ...prev, categories });
};
