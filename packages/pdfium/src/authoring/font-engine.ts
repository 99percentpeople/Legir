// Copyright (c) 2026 Legir contributors. MIT; see ../../LICENSE.
export interface FontGlyph {
  id: number;
  codePoints: number[];
  advanceWidth: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}
export interface FontSubset {
  /** Include a source glyph ID and return its stable PDF CID. */
  includeGlyph(glyphId: number): number;
  /** Complete font program bytes; failures must throw or reject. */
  encode(): Uint8Array | Promise<Uint8Array>;
}
export interface ShapingFont {
  postscriptName: string | null;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  capHeight?: number;
  italicAngle?: number;
  characterSet: number[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** Outline format of the encoded subset. */
  outlineFormat: "truetype" | "cff";
  layout(text: string): {
    glyphs: FontGlyph[];
    positions: { xAdvance: number; yOffset: number }[];
    advanceWidth: number;
  };
  createSubset(): FontSubset;
  /** Full PDF font program, with CIDs/GIDs equal to source glyph IDs.
   * Return raw TrueType or CID-keyed CFF bytes, not WOFF or an OpenType/CFF wrapper.
   */
  encode(): Uint8Array | Promise<Uint8Array>;
}
/** Host-owned font parser/shaper. No PDF, filesystem or network ownership. */
export interface FontEngine {
  createFont(bytes: Uint8Array): ShapingFont | Promise<ShapingFont>;
}
