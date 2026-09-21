import { PDFArray, PDFDict, PDFName, PDFStream } from "@cantoo/pdf-lib";
import { normalizePdfFontName } from "./pdf-font-names";
import {
  decodePdfStreamBytes,
  extractPdfStreamFilters,
} from "./pdf-import-utils";

export type EmbeddedFontLoadCache = Map<string, Promise<string | undefined>>;

const fnv1a32 = (bytes: Uint8Array, maxBytes = 4096) => {
  let hash = 0x811c9dc5;
  const len = Math.min(bytes.length, maxBytes);
  for (let i = 0; i < len; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
};

type EmbeddedFontProgram = {
  stream: PDFStream;
  format: "truetype" | "opentype";
};

const extractEmbeddedFontProgram = (
  fontDict: PDFDict,
  depth = 0,
): EmbeddedFontProgram | undefined => {
  if (depth > 8) return undefined;
  const subtype = fontDict.lookup(PDFName.of("Subtype"));
  const subtypeName = subtype instanceof PDFName ? subtype.decodeText() : "";

  if (subtypeName === "Type0") {
    const descendants = fontDict.lookup(PDFName.of("DescendantFonts"));
    if (descendants instanceof PDFArray && descendants.size() > 0) {
      const first = descendants.lookup(0);
      if (first instanceof PDFDict) {
        const embedded = extractEmbeddedFontProgram(first, depth + 1);
        if (embedded) return embedded;
      }
    }
  }

  const descriptor = fontDict.lookup(PDFName.of("FontDescriptor"));
  if (!(descriptor instanceof PDFDict)) return undefined;

  const fontFile2 = descriptor.lookup(PDFName.of("FontFile2"));
  if (fontFile2 instanceof PDFStream) {
    return { stream: fontFile2, format: "truetype" };
  }

  const fontFile3 = descriptor.lookup(PDFName.of("FontFile3"));
  if (fontFile3 instanceof PDFStream) {
    const subtype = fontFile3.dict.lookup(PDFName.of("Subtype"));
    if (subtype instanceof PDFName && subtype.decodeText() === "OpenType") {
      return { stream: fontFile3, format: "opentype" };
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
  const hash = fnv1a32(embedded.stream.getContents());
  return `pdf-${normalized}-${hash}`;
};

export const ensurePdfEmbeddedFontLoaded = async (
  fontDict: PDFDict,
  pdfFontName: string,
  cache: EmbeddedFontLoadCache,
  loadedFaces?: Set<FontFace>,
): Promise<string | undefined> => {
  if (typeof window === "undefined" || typeof FontFace === "undefined") {
    return undefined;
  }
  if (!document.fonts) return undefined;

  const embedded = extractEmbeddedFontProgram(fontDict);
  if (!embedded) return undefined;
  const bytes = embedded.stream.getContents();
  const normalized = normalizePdfFontName(pdfFontName);
  const family = `pdf-${normalized}-${fnv1a32(bytes)}`;
  const cacheKey = `${family}:${bytes.length}:${embedded.format}`;

  // Cache lookup precedes decompression, buffer copying and FontFace creation.
  // Pending loads and unsupported fonts are also shared within this document.
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const loadAndRegister = async (): Promise<string | undefined> => {
    let decodedBytes: Uint8Array | undefined;
    try {
      // fonts.check() also succeeds for fallback fonts. Inspect registered faces.
      for (const face of document.fonts) {
        if (face.family === family) {
          loadedFaces?.add(face);
          return family;
        }
      }

      decodedBytes = decodePdfStreamBytes(embedded.stream);
      if (!decodedBytes?.length) return undefined;
      const face = new FontFace(family, decodedBytes.slice().buffer, {
        style: "normal",
        weight: "normal",
      });
      await face.load();
      document.fonts.add(face);
      loadedFaces?.add(face);
      return family;
    } catch (error) {
      console.warn("[PDF Import] Embedded font inject failed", {
        pdfFontName,
        family,
        bytes: bytes.length,
        format: embedded.format,
        filters: extractPdfStreamFilters(embedded.stream),
        decodedBytes: decodedBytes?.length,
        error,
      });
      return undefined;
    }
  };

  const promise = loadAndRegister();
  cache.set(cacheKey, promise);
  return promise;
};
