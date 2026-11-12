// Copyright (c) 2026 Legir contributors. MIT; see ../LICENSE.
// Optional adapter: the caller owns/imports fontkit. No font library is bundled
// with the authoring or core entry points.
import type { FontEngine, ShapingFont } from "./authoring/font-engine.js";

type FontkitFace = Omit<
  ShapingFont,
  "outlineFormat" | "createSubset" | "encode"
> & {
  directory: { tables: Record<string, unknown> };
  numGlyphs: number;
  createSubset(): {
    includeGlyph(id: number): number;
    encode(): Uint8Array;
  };
};

/** Adapt upstream fontkit's byte encoder, not the stream-based forks.
 * Collections must be resolved to a single face by the caller's create method.
 */
export function createFontkitEngine(fontkit: {
  create(bytes: Uint8Array): unknown;
}): FontEngine {
  return {
    createFont(bytes) {
      const font = fontkit.create(bytes) as FontkitFace | undefined;
      if (
        !font ||
        typeof font.layout !== "function" ||
        typeof font.createSubset !== "function"
      ) {
        throw new Error("Expected a single font face, not a font collection");
      }
      const cff = !!font.directory.tables["CFF "];
      const encodeGlyphs = (glyphs: readonly number[]) => {
        const subset = font.createSubset();
        for (const id of glyphs) subset.includeGlyph(id);
        // Upstream CFFSubset writes nLeft = glyphCount - 2. An unused
        // font (or .notdef alone) produces -1. Add an unreferenced glyph
        // only to this encoding, without changing document CIDs/content.
        if (cff && glyphs.length === 1) {
          if (font.numGlyphs < 2)
            throw new Error("Cannot subset a CFF font containing only .notdef");
          subset.includeGlyph(1);
        }
        return subset.encode();
      };
      return {
        postscriptName: font.postscriptName,
        unitsPerEm: font.unitsPerEm,
        ascent: font.ascent,
        descent: font.descent,
        capHeight: font.capHeight,
        italicAngle: font.italicAngle,
        characterSet: font.characterSet,
        bbox: font.bbox,
        outlineFormat: cff ? "cff" : "truetype",
        layout: (text) => font.layout(text),
        // Encode all glyphs in source order for subset:false. The input may be
        // an OpenType/WOFF container, not an embeddable PDF font program.
        encode: () =>
          encodeGlyphs(Array.from({ length: font.numGlyphs }, (_, id) => id)),
        createSubset() {
          // Keep our CID assignment stable across saves. Rebuild the encoder
          // each time: upstream encoders can mutate their internal glyph lists.
          const glyphs = [0];
          const cids = new Map([[0, 0]]);
          return {
            includeGlyph(id) {
              let cid = cids.get(id);
              if (cid === undefined) {
                cid = glyphs.length;
                cids.set(id, cid);
                glyphs.push(id);
              }
              return cid;
            },
            encode() {
              return encodeGlyphs(glyphs);
            },
          };
        },
      };
    },
  };
}
