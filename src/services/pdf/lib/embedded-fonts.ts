import { PDFArray, PDFDict, PDFName, PDFStream } from "pdf-lib";
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

const extractEmbeddedFontProgram = (
  fontDict: PDFDict,
): { bytes: Uint8Array; format: "truetype" | "opentype" } | undefined => {
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
    return { bytes: fontFile2.getContents(), format: "truetype" };
  }

  const fontFile3 = descriptor.lookup(PDFName.of("FontFile3"));
  if (fontFile3 instanceof PDFStream) {
    const subtype = fontFile3.dict.lookup(PDFName.of("Subtype"));
    const subtypeName = subtype instanceof PDFName ? subtype.decodeText() : "";
    if (subtypeName === "/OpenType" || subtypeName === "OpenType") {
      return { bytes: fontFile3.getContents(), format: "opentype" };
    }
  }

  return undefined;
};

export const ensurePdfEmbeddedFontLoaded = async (
  fontDict: PDFDict,
  pdfFontName: string,
  cache: EmbeddedFontLoadCache,
  loadedFaces?: Set<FontFace>,
): Promise<string | undefined> => {
  if (typeof window === "undefined") return undefined;
  if (typeof (window as any).FontFace === "undefined") return undefined;
  if (!document?.fonts) return undefined;

  const embedded = extractEmbeddedFontProgram(fontDict);
  if (!embedded) return undefined;

  const normalized = normalizePdfFontName(pdfFontName);
  const hash = fnv1a32(embedded.bytes);
  const family = `pdf-${normalized}-${hash}`;
  const cacheKey = `${family}:${embedded.bytes.length}:${embedded.format}`;

  if (!cache.has(cacheKey)) {
    cache.set(
      cacheKey,
      (async () => {
        try {
          if (document.fonts.check(`12px \"${family}\"`)) return family;
          const face = new FontFace(
            family,
            bufferFromUint8Array(embedded.bytes),
            { style: "normal", weight: "normal" },
          );
          await face.load();
          document.fonts.add(face);
          loadedFaces?.add(face);
          return family;
        } catch {
          return undefined;
        }
      })(),
    );
  }

  return cache.get(cacheKey);
};
