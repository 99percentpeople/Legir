export type ExportFontKit = any;

export type ExportFontConfig = {
  id: "cjk_sans" | "cjk_serif";
  name: string;
  path: string;
  exportKeys: string[];
  importAliases: string[];
};

export const BUILT_IN_EXPORT_FONTS: ExportFontConfig[] = [
  {
    id: "cjk_sans",
    name: "Noto Sans SC",
    path: "fonts/NotoSansSC-Regular.ttf",
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
    path: "fonts/SourceHanSerifSC-Regular.otf",
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

const fetchFontBytes = async (
  path: string,
): Promise<Uint8Array | undefined> => {
  if (typeof fetch === "undefined") return undefined;
  try {
    const res = await fetch(path);
    if (!res.ok) return undefined;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0) return undefined;
    return new Uint8Array(buf);
  } catch {
    return undefined;
  }
};

const setFontMapIfMissing = (
  fontMap: Map<string, any>,
  key: string,
  font: any,
  onlyIfMissing: boolean,
) => {
  if (onlyIfMissing && fontMap.has(key)) return;
  fontMap.set(key, font);
};

export const loadAndEmbedExportFonts = async (args: {
  pdfDoc: any;
  fontMap: Map<string, any>;
  fontkit: ExportFontKit;
  customFont?: { bytes: Uint8Array; name?: string };
}) => {
  const { pdfDoc, fontMap, fontkit, customFont } = args;

  let fontkitRegistered = false;
  const ensureFontkit = () => {
    if (!fontkitRegistered) {
      pdfDoc.registerFontkit(fontkit);
      fontkitRegistered = true;
    }
  };

  // Optional user-provided font -> treat as default CJK sans fallback
  if (customFont?.bytes && customFont.bytes.byteLength > 0) {
    try {
      ensureFontkit();
      const embedded = await pdfDoc.embedFont(customFont.bytes, {
        subset: false,
      });
      const name = (customFont.name || "Custom").trim() || "Custom";
      fontMap.set("Custom", embedded);
      fontMap.set("CustomSans", embedded);
      fontMap.set(name, embedded);
    } catch (e) {
      console.warn("Failed to embed custom font for export", e);
    }
  }

  for (const def of BUILT_IN_EXPORT_FONTS) {
    const bytes = await fetchFontBytes(def.path);
    if (!bytes) {
      console.warn("[PDF Export] Built-in font not found", def.path);
      continue;
    }

    try {
      ensureFontkit();
      const embedded = await pdfDoc.embedFont(bytes, { subset: false });
      for (const key of def.exportKeys) {
        setFontMapIfMissing(fontMap, key, embedded, key.startsWith("Custom"));
      }
      console.info("[PDF Export] Loaded built-in font", def.path);
    } catch (e) {
      console.warn("Failed to embed built-in font for export", def.name, e);
    }
  }
};
