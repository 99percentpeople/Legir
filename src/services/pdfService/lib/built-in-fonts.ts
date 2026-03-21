import type { PDFFont, PDFDocument } from "@cantoo/pdf-lib";
import { getPlatformSystemFontBytes, isDesktopApp } from "@/services/platform";

type Fontkit = Parameters<PDFDocument["registerFontkit"]>[0];

export type ExportFontConfig = {
  id: "cjk_sans" | "cjk_serif";
  name: string;
  path: string;
  systemFamilies: string[];
  generic: "serif" | "sans-serif";
  exportKeys: string[];
  importAliases: string[];
};

export const BUILT_IN_EXPORT_FONTS: ExportFontConfig[] = [
  {
    id: "cjk_sans",
    name: "Noto Sans SC",
    path: "fonts/NotoSansSC-Regular.ttf",
    systemFamilies: [
      "Noto Sans SC",
      "Noto Sans CJK SC",
      "Noto Sans CJK",
      "Microsoft YaHei",
      "Microsoft YaHei UI",
      "PingFang SC",
      "Hiragino Sans GB",
      "WenQuanYi Micro Hei",
    ],
    generic: "sans-serif",
    exportKeys: ["Noto Sans SC", "CustomSans", "Custom"],
    importAliases: [
      "NotoSansSC",
      "NotoSansSC-Regular",
      "NotoSansCJKsc",
      "NotoSansCJKsc-Regular",
      "NotoSansCJKSC",
      "NotoSansCJKSC-Regular",
      "NotoSansCJK",
      "NotoSansCJK-Regular",
    ],
  },
  {
    id: "cjk_serif",
    name: "Source Han Serif SC",
    path: "fonts/SourceHanSerifSC-VF.ttf",
    systemFamilies: [
      "Source Han Serif SC",
      "Source Han Serif",
      "Songti SC",
      "STSong",
      "SimSun",
      "NSimSun",
      "PMingLiU",
      "Noto Serif CJK SC",
    ],
    generic: "serif",
    exportKeys: ["Source Han Serif SC", "CustomSerif"],
    importAliases: [
      "SourceHanSerifSC",
      "SourceHanSerifSC-Regular",
      "SourceHanSerif",
      "SourceHanSerif-Regular",
      "STSong",
      "SongtiSC",
      "Songti SC",
    ],
  },
];

const toPublicUrl = (path: string) => {
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `${normalizedBase}${normalizedPath}`;
};

const fetchFontBytes = async (
  path: string,
): Promise<Uint8Array | undefined> => {
  if (typeof fetch === "undefined") return undefined;
  try {
    const res = await fetch(toPublicUrl(path));
    if (!res.ok) return undefined;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0) return undefined;
    return new Uint8Array(buf);
  } catch {
    return undefined;
  }
};

const setFontMapIfMissing = (
  fontMap: Map<string, PDFFont>,
  key: string,
  font: PDFFont,
  onlyIfMissing: boolean,
) => {
  if (onlyIfMissing && fontMap.has(key)) return;
  fontMap.set(key, font);
};

export const loadAndEmbedExportFonts = async (args: {
  pdfDoc: PDFDocument;
  fontMap: Map<string, PDFFont>;
  fontkit: Fontkit;
  customFont?: { bytes: Uint8Array; name?: string };
  includeFontIds?: Set<ExportFontConfig["id"]>;
  subset?: boolean;
}) => {
  const { pdfDoc, fontMap, fontkit, customFont, includeFontIds } = args;
  const subset = args.subset ?? true;

  let fontkitRegistered = false;
  const ensureFontkit = () => {
    if (!fontkitRegistered) {
      pdfDoc.registerFontkit(fontkit);
      fontkitRegistered = true;
    }
  };

  // Helper: embed font with subset option
  const embedFont = async (
    bytes: Uint8Array,
    useSubset: boolean,
  ): Promise<PDFFont | undefined> => {
    ensureFontkit();
    try {
      return await pdfDoc.embedFont(bytes, { subset: useSubset });
    } catch (e) {
      console.warn("[PDF Export] Font embed failed", e);
      return undefined;
    }
  };

  // Optional user-provided font -> treat as default CJK sans fallback
  if (customFont?.bytes && customFont.bytes.byteLength > 0) {
    const embedded = await embedFont(customFont.bytes, subset);
    if (embedded) {
      const name = (customFont.name || "Custom").trim() || "Custom";
      fontMap.set("Custom", embedded);
      fontMap.set("CustomSans", embedded);
      fontMap.set(name, embedded);
    }
  }

  for (const def of BUILT_IN_EXPORT_FONTS) {
    if (includeFontIds && !includeFontIds.has(def.id)) continue;

    const bytes = isDesktopApp()
      ? await getPlatformSystemFontBytes({
          families: def.systemFamilies,
          generic: def.generic,
        })
      : await fetchFontBytes(def.path);
    if (!bytes) {
      console.warn("[PDF Export] Built-in font not found", def.path);
      continue;
    }

    const embedded = await embedFont(bytes, subset);
    if (embedded) {
      for (const key of def.exportKeys) {
        setFontMapIfMissing(fontMap, key, embedded, key.startsWith("Custom"));
      }
      console.info("[PDF Export] Loaded built-in font", def.path);
    } else {
      console.warn("[PDF Export] Failed to embed built-in font", def.name);
    }
  }
};

export const loadAndEmbedSelectedSystemFonts = async (args: {
  pdfDoc: PDFDocument;
  fontMap: Map<string, PDFFont>;
  fontkit: Fontkit;
  families: string[];
  subset?: boolean;
}) => {
  if (!isDesktopApp()) return;

  const { pdfDoc, fontMap, fontkit } = args;
  const subset = args.subset ?? true;

  let fontkitRegistered = false;
  const ensureFontkit = () => {
    if (!fontkitRegistered) {
      pdfDoc.registerFontkit(fontkit);
      fontkitRegistered = true;
    }
  };

  const embedFont = async (bytes: Uint8Array): Promise<PDFFont | undefined> => {
    ensureFontkit();
    try {
      return await pdfDoc.embedFont(bytes, { subset });
    } catch (e) {
      console.warn("[PDF Export] System font embed failed", e);
      return undefined;
    }
  };

  const normalized = args.families
    .map((f) => (typeof f === "string" ? f.trim() : ""))
    .filter((f) => f.length > 0);

  const uniqueFamilies = Array.from(new Set(normalized)).filter(
    (f) => !fontMap.has(f),
  );

  // Don't attempt to resolve standard/built-in keys via system font lookup.
  const skipKeys = new Set([
    "Helvetica",
    "Times Roman",
    "Courier",
    "Noto Sans SC",
    "Source Han Serif SC",
    "Custom",
    "CustomSans",
    "CustomSerif",
  ]);

  for (const family of uniqueFamilies) {
    if (skipKeys.has(family)) continue;

    try {
      const bytes = await getPlatformSystemFontBytes({
        families: [family],
        generic: null,
      });
      if (!bytes || bytes.byteLength === 0) continue;

      const embedded = await embedFont(bytes);
      if (embedded) {
        fontMap.set(family, embedded);
      }
    } catch {
      // ignore
    }
  }
};
