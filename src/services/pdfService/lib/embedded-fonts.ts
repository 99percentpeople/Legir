import { PDFArray, PDFDict, PDFName, PDFStream } from "@cantoo/pdf-lib";
import { normalizePdfFontName } from "./pdf-font-names";

export type EmbeddedFontLoadCache = Map<string, Promise<string | undefined>>;

const bufferFromUint8Array = (bytes: Uint8Array): ArrayBuffer => {
  return bytes.slice().buffer;
};

const fnv1a32 = (bytes: Uint8Array, maxBytes = 4096) => {
  let hash = 0x811c9dc5;
  const len = Math.min(bytes.length, maxBytes);
  for (let i = 0; i < len; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
};

const extractPdfStreamFilters = (stream: PDFStream): string[] => {
  try {
    const filter = stream.dict.lookup(PDFName.of("Filter"));
    if (filter instanceof PDFName) {
      return [filter.decodeText().replace(/^\//, "")];
    }
    if (filter instanceof PDFArray) {
      const out: string[] = [];
      for (let i = 0; i < filter.size(); i++) {
        const item = filter.lookup(i);
        if (item instanceof PDFName) {
          out.push(item.decodeText().replace(/^\//, ""));
        }
      }
      return out;
    }
  } catch {
    // ignore
  }
  return [];
};

const maybeDecodeFontStreamBytes = async (args: {
  bytes: Uint8Array;
  filters: string[];
}): Promise<Uint8Array> => {
  const { bytes, filters } = args;
  if (!filters || filters.length === 0) return bytes;

  const magicHex = (b: Uint8Array) => {
    const head = b.slice(0, 4);
    return Array.from(head)
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  };

  const magicAscii = (b: Uint8Array) => {
    try {
      return new TextDecoder().decode(b.slice(0, 4));
    } catch {
      return "";
    }
  };

  const looksLikeFont = (b: Uint8Array) => {
    if (!b || b.length < 4) return false;
    const hex = magicHex(b);
    const ascii = magicAscii(b);
    // sfnt versions
    if (hex === "00010000") return true; // TrueType
    if (hex === "74727565") return true; // 'true'
    if (ascii === "OTTO") return true; // CFF OpenType
    if (ascii === "ttcf") return true; // TTC
    // Webfont containers
    if (ascii === "wOFF") return true;
    if (ascii === "wOF2") return true;
    return false;
  };

  // Common case: FlateDecode. (PDF flate is compatible with DecompressionStream('deflate')
  // in modern browsers; if it fails we just fall back to raw bytes.)
  const g = globalThis as unknown as { DecompressionStream?: unknown };
  if (
    filters.includes("FlateDecode") &&
    typeof g.DecompressionStream !== "undefined"
  ) {
    const tryInflate = async (format: "deflate" | "deflate-raw") => {
      const DS = g.DecompressionStream as unknown as new (
        fmt: string,
      ) => DecompressionStream;
      const ds = new DS(format);
      const safeBytes = new Uint8Array(bytes);
      const decompressed = await new Response(
        new Blob([safeBytes]).stream().pipeThrough(ds),
      ).arrayBuffer();
      return new Uint8Array(decompressed);
    };

    try {
      const d1 = await tryInflate("deflate");
      if (looksLikeFont(d1)) return d1;
      const d2 = await tryInflate("deflate-raw");
      if (looksLikeFont(d2)) return d2;
      // If neither looks like a font, prefer the larger output (heuristic).
      return d2.length > d1.length ? d2 : d1;
    } catch {
      try {
        const d2 = await tryInflate("deflate-raw");
        return d2;
      } catch {
        return bytes;
      }
    }
  }

  return bytes;
};

const extractEmbeddedFontProgram = (
  fontDict: PDFDict,
):
  | {
      bytes: Uint8Array;
      format: "truetype" | "opentype";
      filters: string[];
    }
  | undefined => {
  const subtype = fontDict.lookup(PDFName.of("Subtype"));
  const subtypeName = subtype instanceof PDFName ? subtype.decodeText() : "";

  if (subtypeName === "/Type0" || subtypeName === "Type0") {
    const descendants = fontDict.lookup(PDFName.of("DescendantFonts"));
    if (descendants instanceof PDFArray && descendants.size() > 0) {
      const first = descendants.lookup(0);
      if (first instanceof PDFDict) {
        const embedded = extractEmbeddedFontProgram(first);
        if (embedded) return embedded;
      }
    }
  }

  const descriptor = fontDict.lookup(PDFName.of("FontDescriptor"));
  if (!(descriptor instanceof PDFDict)) return undefined;

  const fontFile2 = descriptor.lookup(PDFName.of("FontFile2"));
  if (fontFile2 instanceof PDFStream) {
    return {
      bytes: fontFile2.getContents(),
      format: "truetype",
      filters: extractPdfStreamFilters(fontFile2),
    };
  }

  const fontFile3 = descriptor.lookup(PDFName.of("FontFile3"));
  if (fontFile3 instanceof PDFStream) {
    const subtype = fontFile3.dict.lookup(PDFName.of("Subtype"));
    const subtypeName = subtype instanceof PDFName ? subtype.decodeText() : "";
    if (subtypeName === "/OpenType" || subtypeName === "OpenType") {
      return {
        bytes: fontFile3.getContents(),
        format: "opentype",
        filters: extractPdfStreamFilters(fontFile3),
      };
    }
  }

  return undefined;
};

export const derivePdfEmbeddedFontFamily = (
  fontDict: PDFDict,
  pdfFontName: string,
): string | undefined => {
  const embedded = extractEmbeddedFontProgram(fontDict);
  if (!embedded) return undefined;
  const normalized = normalizePdfFontName(pdfFontName);
  const hash = fnv1a32(embedded.bytes);
  return `pdf-${normalized}-${hash}`;
};

export const ensurePdfEmbeddedFontLoaded = async (
  fontDict: PDFDict,
  pdfFontName: string,
  cache: EmbeddedFontLoadCache,
  loadedFaces?: Set<FontFace>,
): Promise<string | undefined> => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { FontFace?: unknown };
  if (typeof w.FontFace === "undefined") return undefined;
  if (!document?.fonts) return undefined;

  const embedded = extractEmbeddedFontProgram(fontDict);
  if (!embedded) return undefined;

  const fontBytesForLoad = await maybeDecodeFontStreamBytes({
    bytes: embedded.bytes,
    filters: embedded.filters,
  });

  const getDecodedHeader = (): { ascii: string; hex: string } | undefined => {
    try {
      const head = fontBytesForLoad.slice(0, 4);
      const ascii = new TextDecoder().decode(head);
      const hex = Array.from(head)
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      return { ascii, hex };
    } catch {
      return undefined;
    }
  };

  const decodedHeader = getDecodedHeader();

  const normalized = normalizePdfFontName(pdfFontName);
  const hash = fnv1a32(embedded.bytes);
  const family = `pdf-${normalized}-${hash}`;
  const cacheKey = `${family}:${embedded.bytes.length}:${embedded.format}`;

  const loadAndRegister = async (): Promise<string | undefined> => {
    try {
      // Don't rely on `document.fonts.check(...)` here: it can report `true` even when
      // the specific family isn't actually registered (e.g. falling back to a default font).
      // Instead, only treat the font as loaded if the FontFaceSet contains the family.
      let foundExistingFace = false;
      try {
        for (const face of document.fonts) {
          if (face.family === family) {
            foundExistingFace = true;
            loadedFaces?.add(face);
          }
        }
      } catch {
        // ignore
      }

      if (foundExistingFace) return family;

      const face = new FontFace(
        family,
        bufferFromUint8Array(fontBytesForLoad),
        { style: "normal", weight: "normal" },
      );
      await face.load();
      document.fonts.add(face);
      loadedFaces?.add(face);
      return family;
    } catch (e) {
      console.warn("[PDF Import] Embedded font inject failed", {
        pdfFontName,
        family,
        bytes: embedded.bytes.length,
        format: embedded.format,
        filters: embedded.filters,
        decodedBytes: fontBytesForLoad.length,
        decodedHeader,
        error: e,
      });
      return undefined;
    }
  };

  if (!cache.has(cacheKey)) {
    const promise = loadAndRegister();
    cache.set(cacheKey, promise);
  }

  return cache.get(cacheKey);
};
