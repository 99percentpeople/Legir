// Copyright (c) 2026 Legir contributors. BSD-3-Clause.
import type { PDFDocument } from "./document.js";
import {
  PDFContext,
  PDFDict,
  PDFHexString,
  PDFRef,
  PDFString,
  bytesToHex,
  utf16,
} from "./objects.js";

export enum StandardFonts {
  Courier = "Courier",
  CourierBold = "Courier-Bold",
  CourierOblique = "Courier-Oblique",
  CourierBoldOblique = "Courier-BoldOblique",
  Helvetica = "Helvetica",
  HelveticaBold = "Helvetica-Bold",
  HelveticaOblique = "Helvetica-Oblique",
  HelveticaBoldOblique = "Helvetica-BoldOblique",
  TimesRoman = "Times-Roman",
  TimesRomanBold = "Times-Bold",
  TimesRomanItalic = "Times-Italic",
  TimesRomanBoldItalic = "Times-BoldItalic",
  Symbol = "Symbol",
  ZapfDingbats = "ZapfDingbats",
}
// Adobe Base-14 ascender/descender metrics in 1/1000 em. Native glyph
// advances/encoding still come from PDFium, but a substituted font's ascent
// must not change the document's line spacing or auto-fit field sizes.
function standardVerticalMetrics(name: string): [number, number] {
  if (name.startsWith("Helvetica")) return [718, -207];
  if (name.startsWith("Courier")) return [629, -157];
  if (name.startsWith("Times")) return [683, -217];
  return name === "Symbol" ? [1010, -293] : [820, -143];
}
export interface FontGlyph {
  id: number;
  codePoints: number[];
  advanceWidth: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}
export interface FontSubset {
  includeGlyph(glyph: FontGlyph | number): number;
  encodeStream(): {
    on(event: string, fn: (value: Uint8Array) => void): unknown;
  };
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
  cff?: unknown;
  layout(text: string): {
    glyphs: FontGlyph[];
    positions: { xAdvance: number; yOffset: number }[];
    advanceWidth: number;
  };
  createSubset(): FontSubset;
}
export type Fontkit = { create(bytes: Uint8Array): ShapingFont };

/** Font resources live in the editor's native xref. Only glyph subsets and
 * layout metrics live in JS; this object never parses or saves a PDF. */
export class PDFFont {
  readonly ref: PDFRef;
  readonly name: string;
  readonly embedder: {
    font:
      | ShapingFont
      | { CapHeight: number; Ascender: number; FontBBox: number[] };
    scale?: number;
  };
  private readonly metrics = new Map<number, number[]>();
  private readonly used = new Map<
    number,
    { glyph: FontGlyph; unicode: number[] }
  >();
  private readonly subset?: FontSubset;
  private dirty = false;
  private readonly dict: PDFDict;
  private readonly fontFileRef?: PDFRef;
  private readonly descendantRef?: PDFRef;
  private readonly toUnicodeRef?: PDFRef;
  private readonly descriptorRef?: PDFRef;
  constructor(
    readonly context: PDFContext,
    source: string | Uint8Array,
    private readonly shaping?: ShapingFont,
    subset = true,
    readonly doc?: PDFDocument,
  ) {
    if (typeof source === "string") {
      this.name = source;
      this.dict = context.obj({
        Type: "Font",
        Subtype: "Type1",
        BaseFont: source,
        ...(source === "Symbol" || source === "ZapfDingbats"
          ? {}
          : { Encoding: "WinAnsiEncoding" }),
      });
      this.ref = context.register(this.dict);
      const metrics = this.metric(72);
      this.embedder = {
        font: {
          CapHeight: metrics[5] || 700,
          Ascender: standardVerticalMetrics(source)[0],
          FontBBox: [0, metrics[7], 1000, metrics[6]],
        },
      };
    } else {
      if (!shaping)
        throw new Error(
          "Register a font shaper before embedding a custom font",
        );
      this.source = source;
      this.subset = subset ? shaping.createSubset() : undefined;
      this.name = `${subset ? "LEGIRF+" : ""}${(shaping.postscriptName || "CustomFont").replace(/[^\w+-]/g, "")}-${context.largestObjectNumber + 1}`;
      this.embedder = { font: shaping, scale: 1000 / shaping.unitsPerEm };
      this.fontFileRef = context.nextRef();
      this.descriptorRef = context.nextRef();
      this.descendantRef = context.nextRef();
      this.toUnicodeRef = context.nextRef();
      this.dict = context.obj({
        Type: "Font",
        Subtype: "Type0",
        BaseFont: this.name,
        Encoding: "Identity-H",
        DescendantFonts: [this.descendantRef],
        ToUnicode: this.toUnicodeRef,
      });
      this.ref = context.register(this.dict);
      this.dirty = true;
    }
  }
  private readonly source?: Uint8Array;
  private metric(unicode: number) {
    let result = this.metrics.get(unicode);
    if (!result) {
      result = Array.from(this.context.fontMetrics(this.ref, [unicode]));
      this.metrics.set(unicode, result);
    }
    return result;
  }
  getCharacterSet() {
    return (
      this.shaping?.characterSet ?? this.context.fontCharacterSet(this.ref)
    );
  }
  encodeText(text: string): PDFHexString {
    if (!this.shaping) {
      return PDFHexString.fromBytes(
        Uint8Array.from(
          Array.from(text, (char) => {
            const code = this.metric(char.codePointAt(0)!)[0];
            if (code === 0xffffffff || code > 255)
              throw new Error(
                `${this.name} cannot encode ${JSON.stringify(char)}`,
              );
            return code;
          }),
        ),
      );
    }
    const run = this.shaping.layout(text);
    const output = new Uint8Array(run.glyphs.length * 2);
    run.glyphs.forEach((glyph, index) => {
      const cid = this.subset ? this.subset.includeGlyph(glyph) : glyph.id;
      if (!this.used.has(cid)) {
        this.used.set(cid, { glyph, unicode: glyph.codePoints });
        this.dirty = true;
      }
      output[index * 2] = cid >> 8;
      output[index * 2 + 1] = cid & 255;
    });
    return PDFHexString.fromBytes(output);
  }
  widthOfTextAtSize(text: string, size: number) {
    return this.shaping
      ? (this.shaping
          .layout(text)
          .glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0) *
          size) /
          this.shaping.unitsPerEm
      : (Array.from(text).reduce(
          (sum, c) => sum + this.metric(c.codePointAt(0)!)[1],
          0,
        ) *
          size) /
          1000;
  }
  heightAtSize(size: number, options: { descender?: boolean } = {}) {
    const ascent =
      this.shaping?.ascent ?? standardVerticalMetrics(this.name)[0];
    const descent =
      options.descender === false
        ? 0
        : (this.shaping?.descent ?? standardVerticalMetrics(this.name)[1]);
    return ((ascent - descent) / (this.shaping?.unitsPerEm ?? 1000)) * size;
  }
  sizeAtHeight(height: number) {
    return height / this.heightAtSize(1);
  }
  async embed() {
    if (!this.shaping || !this.dirty) return;
    const font = this.shaping,
      scale = 1000 / font.unitsPerEm,
      context = this.context;
    let data = this.source!;
    if (this.subset)
      data = await new Promise<Uint8Array>((resolve, reject) => {
        const chunks: Uint8Array[] = [];
        let size = 0;
        const stream = this.subset!.encodeStream();
        stream.on("data", (bytes) => {
          chunks.push(bytes);
          size += bytes.length;
        });
        stream.on("end", () => {
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          resolve(bytes);
        });
        stream.on("error", reject);
      });
    const cff = !!font.cff;
    context.assign(
      this.fontFileRef!,
      context.flateStream(data, {
        ...(cff ? { Subtype: "CIDFontType0C" } : { Length1: data.length }),
      }),
    );
    context.assign(
      this.descriptorRef!,
      context.obj({
        Type: "FontDescriptor",
        FontName: this.name,
        Flags: 4,
        FontBBox: [
          font.bbox.minX * scale,
          font.bbox.minY * scale,
          font.bbox.maxX * scale,
          font.bbox.maxY * scale,
        ],
        ItalicAngle: font.italicAngle ?? 0,
        Ascent: font.ascent * scale,
        Descent: font.descent * scale,
        CapHeight: (font.capHeight ?? font.ascent) * scale,
        StemV: 80,
        [cff ? "FontFile3" : "FontFile2"]: this.fontFileRef,
      }),
    );
    const entries = [...this.used].sort((a, b) => a[0] - b[0]);
    context.assign(
      this.descendantRef!,
      context.obj({
        Type: "Font",
        Subtype: cff ? "CIDFontType0" : "CIDFontType2",
        BaseFont: this.name,
        CIDSystemInfo: {
          Registry: PDFString.of("Adobe"),
          Ordering: PDFString.of("Identity"),
          Supplement: 0,
        },
        FontDescriptor: this.descriptorRef,
        DW: 1000,
        W: entries.flatMap(([cid, { glyph }]) => [
          cid,
          [glyph.advanceWidth * scale],
        ]),
        ...(cff ? {} : { CIDToGIDMap: "Identity" }),
      }),
    );
    const lines = [
      "/CIDInit /ProcSet findresource begin",
      "12 dict begin",
      "begincmap",
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
      "/CMapName /LegirUnicode def",
      "/CMapType 2 def",
      "1 begincodespacerange",
      "<0000> <ffff>",
      "endcodespacerange",
    ];
    for (let i = 0; i < entries.length; i += 100) {
      const batch = entries.slice(i, i + 100);
      lines.push(`${batch.length} beginbfchar`);
      for (const [cid, { unicode }] of batch)
        lines.push(
          `<${cid.toString(16).padStart(4, "0")}> <${bytesToHex(utf16(String.fromCodePoint(...(unicode.length ? unicode : [0xfffd]))).subarray(2))}>`,
        );
      lines.push("endbfchar");
    }
    lines.push(
      "endcmap",
      "CMapName currentdict /CMap defineresource pop",
      "end",
      "end",
    );
    context.assign(this.toUnicodeRef!, context.flateStream(lines.join("\n")));
    this.dirty = false;
  }
}
